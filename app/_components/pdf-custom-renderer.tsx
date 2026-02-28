import { useEffect, useMemo, useRef, useCallback } from "react";
import invariant from "tiny-invariant";
import { usePageContext, useDocumentContext } from "react-pdf";

import type {
  RenderParameters,
  PDFDocumentProxy,
} from "pdfjs-dist/types/src/display/api.js";
import { PDFPageProxy } from "pdfjs-dist";
import { PDF_TO_CSS_UNITS } from "@/_lib/pixels-per-inch";
import {
  erodeImageData,
  erosionFilter,
  enhanceLineQualityFast,
  recolourImageData,
} from "@/_lib/erode";
import useRenderContext from "@/_hooks/use-render-context";

// Cache for rendered pages at different erosion levels (Safari only)
// Key format: `${pageNumber}-${erosions}-${width}-${height}`
const renderCache = new Map<string, ImageData>();
const MAX_CACHE_SIZE = 20; // Limit cache to prevent memory issues

function getCacheKey(
  pageNumber: number,
  erosions: number,
  width: number,
  height: number,
  recolourHex?: string,
  renderVersion?: number,
): string {
  return `${pageNumber}-${erosions}-${width}-${height}-${recolourHex ?? ""}-${renderVersion ?? 0}`;
}

function addToCache(key: string, data: ImageData) {
  // Evict oldest entries if cache is full
  if (renderCache.size >= MAX_CACHE_SIZE) {
    const firstKey = renderCache.keys().next().value;
    if (firstKey) renderCache.delete(firstKey);
  }
  renderCache.set(key, data);
}

/**
 * Clears all cached rendered page image data.
 * Call this when you want to force pages to re-render from scratch (e.g. for debugging).
 */
export function clearRenderCache() {
  renderCache.clear();
}

export default function CustomRenderer() {
  const {
    erosions,
    layers,
    magnifying,
    onPageRenderStart,
    onPageRenderSuccess,
    patternScale,
    recolourHex,
    renderVersion,
  } = useRenderContext();
  const pageContext = usePageContext();

  invariant(pageContext, "Unable to find Page context.");

  const docContext = useDocumentContext();

  invariant(docContext, "Unable to find Document context.");

  const isSafari = useMemo(() => {
    const ua = navigator.userAgent.toLowerCase();
    return ua.indexOf("safari") != -1 && ua.indexOf("chrome") == -1;
  }, []);

  // Safari doesn't support feMorphology (erode) or SVG filter references on canvas CSS.
  // So on Safari: all processing (erode, push-darks) is done via pixels.
  // On other browsers: the full chain runs as canvas 2D CSS filters.
  //
  // When recolourHex is set, we use the feColorMatrix recolour filter on the canvas
  // draw call. This maps black→target colour and white→black in one step.
  // The container filter should be "none" for colour themes.
  const useRecolour = !!recolourHex && !isSafari;
  const cssFilter = isSafari
    ? undefined // Safari: all processing done via pixels (no CSS filter on canvas)
    : erosionFilter(magnifying ? 0 : erosions, useRecolour);

  // Safari does erosion and enhancement via pixel manipulation
  const renderErosions = isSafari ? (magnifying ? 0 : erosions) : 0;

  const _className = pageContext._className;
  const page = pageContext.page;
  const pdf = docContext.pdf;

  const canvasElement = useRef<HTMLCanvasElement>(null);
  const backCanvas = useRef<HTMLCanvasElement | null>(null);
  const offscreen = useRef<OffscreenCanvas | null>(null);

  // Track rendering state
  const renderTaskRef = useRef<ReturnType<PDFPageProxy["render"]> | null>(null);

  // Track last rendered params to only signal loading when they change
  const lastRenderedParams = useRef<string>("");

  // Last content key for which we actually rendered, used to detect when a
  // re-render is needed because content (not just scale) changed.
  const lastContentKeyRef = useRef("");
  // Track layers object identity so we can include it in the content key
  // without having to serialise the whole object.
  const layersRef = useRef(layers);
  const layersVersionRef = useRef(0);

  const userUnit = (page as PDFPageProxy).userUnit || 1;

  invariant(page, "Unable to find page.");
  invariant(pdf, "Unable to find pdf.");

  const viewport = useMemo(() => page.getViewport({ scale: 1 }), [page]);

  const renderViewport = useMemo(
    () =>
      page.getViewport({
        scale: getScale(
          viewport.width,
          viewport.height,
          userUnit,
          patternScale,
        ),
      }),
    [page, viewport, userUnit, patternScale],
  );

  const renderWidth = Math.floor(renderViewport.width);
  const renderHeight = Math.floor(renderViewport.height);
  const pageNumber = (page as PDFPageProxy).pageNumber;

  // Keep refs in sync so drawPageOnCanvas can always read the latest dimensions
  // without them needing to be in its dependency array (see below).
  const renderViewportRef = useRef(renderViewport);
  renderViewportRef.current = renderViewport;
  const renderWidthRef = useRef(renderWidth);
  renderWidthRef.current = renderWidth;
  const renderHeightRef = useRef(renderHeight);
  renderHeightRef.current = renderHeight;

  // Ensure back canvas exists for Safari pixel processing
  if (isSafari && backCanvas.current === null) {
    backCanvas.current = document.createElement("canvas");
  }

  if (
    offscreen.current === null ||
    offscreen.current.width !== renderWidth ||
    offscreen.current.height !== renderHeight
  ) {
    // Some iPad's don't support OffscreenCanvas.
    if (!isSafari) {
      offscreen.current = new OffscreenCanvas(renderWidth, renderHeight);
    }
  }

  const drawPageOnCanvas = useCallback(() => {
    const visibleCanvas = canvasElement.current;
    if (!page || !visibleCanvas) {
      return;
    }

    // Read latest dimensions from refs — they are always current even though
    // they are deliberately NOT in this callback's dependency array.  This
    // prevents the callback from being recreated (and the effect from firing)
    // on every patternScale step when only the scale changes.
    const renderWidth = renderWidthRef.current;
    const renderHeight = renderHeightRef.current;
    const renderViewport = renderViewportRef.current;

    // Detect layers identity changes so we can include them in the content key.
    if (layersRef.current !== layers) {
      layersRef.current = layers;
      layersVersionRef.current++;
    }

    // Content key captures everything that affects what pixels look like,
    // deliberately excluding renderWidth/renderHeight.
    const contentKey = `${pageNumber}-${renderErosions}-${recolourHex ?? ""}-${renderVersion ?? 0}-${layersVersionRef.current}`;

    // When zooming out the existing canvas pixels remain valid — CSS width/height
    // already handles the visual downscale, so there is no need to re-render.
    // Use the canvas's own dimensions as ground truth rather than a separate ref:
    // if the canvas already holds pixels at >= the required resolution and content
    // hasn't changed, skip the render entirely.
    const canvasHasPixels =
      visibleCanvas.width > 0 && visibleCanvas.height > 0;
    if (
      contentKey === lastContentKeyRef.current &&
      canvasHasPixels &&
      renderWidth <= visibleCanvas.width &&
      renderHeight <= visibleCanvas.height
    ) {
      if (renderWidth < visibleCanvas.width || renderHeight < visibleCanvas.height) {
        console.log(`[render p${pageNumber}] skip (zoom-out): have ${visibleCanvas.width}×${visibleCanvas.height}, need ${renderWidth}×${renderHeight}`);
      }
      onPageRenderSuccess();
      return;
    }

    // Commit the new content key now that we're actually going to render.
    lastContentKeyRef.current = contentKey;

    // Check cache first (Safari only, since non-Safari uses CSS filters)
    const cacheKey = getCacheKey(
      pageNumber,
      renderErosions,
      renderWidth,
      renderHeight,
      recolourHex,
      renderVersion,
    );
    const cachedData = isSafari ? renderCache.get(cacheKey) : null;

    if (cachedData && isSafari) {
      // Use cached data - instant display
      lastRenderedParams.current = cacheKey;
      // Only update canvas dimensions if they changed to avoid layout shift
      if (
        visibleCanvas.width !== renderWidth ||
        visibleCanvas.height !== renderHeight
      ) {
        visibleCanvas.width = renderWidth;
        visibleCanvas.height = renderHeight;
      }
      const ctx = visibleCanvas.getContext("2d", { alpha: false });
      if (ctx) {
        ctx.putImageData(cachedData, 0, 0);
      }
      onPageRenderSuccess();
      return;
    }

    // Only signal loading if params actually changed (not just a re-render)
    const currentParams = `${pageNumber}-${renderErosions}-${renderWidth}-${renderHeight}-${recolourHex ?? ""}-${renderVersion ?? 0}`;
    if (lastRenderedParams.current !== currentParams) {
      onPageRenderStart();
      lastRenderedParams.current = currentParams;
    }

    const t0 = performance.now();
    console.log(`[render p${pageNumber}] start ${renderWidth}×${renderHeight}`);

    // Cancel any existing render task
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
    }

    page.cleanup();

    // For Safari, render to back buffer first for pixel processing
    const renderTarget = isSafari
      ? backCanvas.current
      : offscreen.current ?? visibleCanvas;

    if (!renderTarget) {
      return;
    }

    // Set up render target dimensions
    if (renderTarget instanceof HTMLCanvasElement) {
      renderTarget.width = renderWidth;
      renderTarget.height = renderHeight;
    }

    async function optionalContentConfigPromise(pdf: PDFDocumentProxy) {
      const optionalContentConfig = await pdf.getOptionalContentConfig();
      for (const layer of Object.values(layers)) {
        for (const id of layer.ids) {
          optionalContentConfig.setVisibility(id, layer.visible);
        }
      }
      return optionalContentConfig;
    }

    const ctx = renderTarget.getContext("2d", {
      alpha: false,
      willReadFrequently: true,
    }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) {
      return;
    }
    const renderContext: RenderParameters = {
      canvasContext: ctx as any,
      viewport: renderViewport,
      optionalContentConfigPromise: pdf
        ? optionalContentConfigPromise(pdf)
        : undefined,
    };

    const cancellable = page.render(renderContext);
    renderTaskRef.current = cancellable;

    cancellable.promise
      .then(() => {
        const t1 = performance.now();
        console.log(`[render p${pageNumber}] pdfjs done in ${(t1 - t0).toFixed(0)}ms`);
        if (isSafari) {
          // Safari path: do erosion and enhancement via pixels
          // Use setTimeout to yield to browser and keep UI responsive
          setTimeout(() => {
            let result = ctx.getImageData(0, 0, renderWidth, renderHeight);

            if (renderErosions > 0) {
              let buffer = new ImageData(renderWidth, renderHeight);
              for (let i = 0; i < renderErosions; i++) {
                erodeImageData(result, buffer);
                [result, buffer] = [buffer, result];
              }
            }

            // Always apply enhancement (gamma + contrast) for Safari using fast LUT
            enhanceLineQualityFast(result, 2, 1.5);

            // If recolouring, apply pixel-level recolour (maps luminance to target colour)
            if (recolourHex) {
              recolourImageData(result, recolourHex);
            }

            const t2 = performance.now();
            console.log(`[render p${pageNumber}] pixel processing done in ${(t2 - t1).toFixed(0)}ms`);

            // Cache the processed result for quick switching
            addToCache(cacheKey, result);

            // Yield again before final canvas update
            setTimeout(() => {
              // Only update canvas dimensions if they changed to avoid layout shift
              if (
                visibleCanvas.width !== renderWidth ||
                visibleCanvas.height !== renderHeight
              ) {
                visibleCanvas.width = renderWidth;
                visibleCanvas.height = renderHeight;
              }
              const dest = visibleCanvas.getContext("2d", { alpha: false });
              if (dest) {
                dest.putImageData(result, 0, 0);
              }
              const t3 = performance.now();
              console.log(`[render p${pageNumber}] total ${(t3 - t0).toFixed(0)}ms (pdfjs: ${(t1 - t0).toFixed(0)}ms, pixels: ${(t2 - t1).toFixed(0)}ms, draw: ${(t3 - t2).toFixed(0)}ms)`);
              onPageRenderSuccess();
            }, 0);
          }, 0);
        } else {
          // Non-Safari: draw from offscreen to visible canvas with CSS filter
          // Only update canvas dimensions if they changed to avoid layout shift
          if (
            visibleCanvas.width !== renderWidth ||
            visibleCanvas.height !== renderHeight
          ) {
            visibleCanvas.width = renderWidth;
            visibleCanvas.height = renderHeight;
          }
          const dest = visibleCanvas.getContext("2d");
          if (!dest) {
            return;
          }
          dest.imageSmoothingEnabled = false;
          dest.filter = cssFilter ?? "none";
          dest.drawImage(renderTarget, 0, 0);
          const t2 = performance.now();
          console.log(`[render p${pageNumber}] total ${(t2 - t0).toFixed(0)}ms (pdfjs: ${(t1 - t0).toFixed(0)}ms, draw: ${(t2 - t1).toFixed(0)}ms)`);
          onPageRenderSuccess();
        }
      })
      .catch(() => {
        // Render was cancelled
      });

    return () => {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
    };
  }, [
    page,
    layers,
    pdf,
    cssFilter,
    renderErosions,
    isSafari,
    pageNumber,
    recolourHex,
    renderVersion,
    onPageRenderStart,
    onPageRenderSuccess,
    // renderViewport, renderWidth, renderHeight intentionally omitted — they are
    // read from refs inside the callback so they're always fresh without this
    // callback needing to be recreated on every zoom step. The effect below
    // lists renderWidth/renderHeight directly in its own deps to catch zoom-ins.
  ]);

  // Single effect covering both cases:
  // - content changes (drawPageOnCanvas gets a new reference)
  // - zoom changes (renderWidth/renderHeight change)
  // The guard logic inside drawPageOnCanvas decides whether to actually render
  // or skip (zoom-out with existing pixels is skipped; zoom-in triggers a render).
  // Having one effect prevents the double-render that occurred on mount when two
  // separate effects both fired in the same commit.
  useEffect(() => {
    drawPageOnCanvas();
  }, [drawPageOnCanvas, renderWidth, renderHeight]);

  const canvasStyle = {
    width:
      Math.floor(viewport.width * PDF_TO_CSS_UNITS * userUnit * patternScale) +
      "px",
    height:
      Math.floor(viewport.height * PDF_TO_CSS_UNITS * userUnit * patternScale) +
      "px",
  };

  return (
    <canvas
      className={`${_className}__canvas`}
      ref={canvasElement}
      style={canvasStyle}
    />
  );
}

function getScale(
  w: number,
  h: number,
  userUnit: number,
  patternScale: number,
): number {
  const dpr = window.devicePixelRatio;
  const dpi = dpr * userUnit * PDF_TO_CSS_UNITS * patternScale;
  const renderArea = dpi * w * dpi * h;
  const maxArea = 16_777_216; // limit for iOS or Android device canvas size https://jhildenbiddle.github.io/canvas-size/#/?id=test-results
  let scale = dpi;
  if (renderArea > maxArea) {
    // scale to fit max area.
    scale = Math.sqrt(maxArea / (w * h));
    console.log(
      `Canvas area ${renderArea} exceeds max area ${maxArea}, scaling by ${scale} instead.`,
    );
  }
  return scale;
}
