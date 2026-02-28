import { useEffect, useMemo, useRef, useCallback } from "react";
import invariant from "tiny-invariant";
import { usePageContext, useDocumentContext } from "react-pdf";
import type { PixelProcessRequest, PixelProcessResponse } from "@/_lib/pixel-processor.worker";

import type {
  RenderParameters,
  PDFDocumentProxy,
} from "pdfjs-dist/types/src/display/api.js";
import { PDFPageProxy } from "pdfjs-dist";
import { PDF_TO_CSS_UNITS } from "@/_lib/pixels-per-inch";
import {
  erosionFilter,
} from "@/_lib/erode";
import useRenderContext from "@/_hooks/use-render-context";

// Cache for rendered pages as ImageBitmap (Safari only).
// ImageBitmap lives on the GPU — drawImage is instant vs putImageData which is slow+blocking.
// Key format: `${pageNumber}-${erosions}-${width}-${height}-${recolourHex}-${renderVersion}`
const renderCache = new Map<string, ImageBitmap>();
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

function addToCache(key: string, bitmap: ImageBitmap) {
  // Evict oldest entries if cache is full
  if (renderCache.size >= MAX_CACHE_SIZE) {
    const firstKey = renderCache.keys().next().value;
    if (firstKey) {
      renderCache.get(firstKey)?.close(); // free GPU memory
      renderCache.delete(firstKey);
    }
  }
  renderCache.set(key, bitmap);
}

/**
 * Clears all cached rendered page image data.
 * Call this when you want to force pages to re-render from scratch (e.g. for debugging).
 */
export function clearRenderCache() {
  renderCache.forEach((bitmap) => bitmap.close()); // free GPU memory
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
    themeFilter,
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
  // So on Safari: all processing (erode, push-darks, recolouring, inversion) is done via pixels.
  // On other browsers: the full chain runs as canvas 2D CSS filters.
  //
  // The container div's filter is always "none" — theme transformation is baked
  // into the canvas pixels on both paths, preventing the split-ownership flash.
  const useRecolour = !!recolourHex && !isSafari;
  // Build the full canvas draw filter for non-Safari browsers.
  // Appending themeFilter here (e.g. "invert(1)" for Dark theme) means the
  // canvas already holds the final inverted/coloured pixels, so the container
  // div doesn't need a CSS filter. This prevents the flash that occurred when
  // the container filter committed synchronously but the canvas content was
  // still stale from the previous theme.
  const cssFilter = isSafari
    ? undefined // Safari: all processing done via pixels (no CSS filter on canvas)
    : [
        erosionFilter(magnifying ? 0 : erosions, useRecolour),
        themeFilter && themeFilter !== "none" ? themeFilter : undefined,
      ]
        .filter(Boolean)
        .join(" ");

  // Safari does erosion and enhancement via pixel manipulation
  const renderErosions = isSafari ? (magnifying ? 0 : erosions) : 0;

  // Effective recolour target for the Safari pixel-processing path.
  // Colour themes: use recolourHex directly (green, cyan, amber, magenta).
  // Dark theme: themeFilter is "invert(1)" — treat as recolour-to-white so
  // the worker inverts the pixels at pixel level. This keeps the canvas
  // self-contained (container filter is always "none") and means the old
  // dark canvas stays visible while the new render is in flight, preventing
  // the flash of non-inverted content when switching themes on Safari.
  const safariEffectiveRecolourHex = isSafari
    ? (recolourHex ?? (themeFilter === "invert(1)" ? "#ffffff" : undefined))
    : undefined;

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

  // Off-main-thread pixel processing (Safari path).
  // One worker per component instance, created lazily, terminated on unmount.
  const workerRef = useRef<Worker | null>(null);
  // Monotonically increasing ID so we can discard stale worker responses.
  const renderIdRef = useRef(0);

  const getWorker = useCallback((): Worker => {
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL("../_lib/pixel-processor.worker", import.meta.url),
      );
    }
    return workerRef.current;
  }, []);

  // Terminate the worker when the component unmounts.
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);
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
    // - renderErosions: pixel erosion applied on Safari
    // - cssFilter: CSS filter applied on Chrome (encodes erosion + magnifying + theme filter)
    // - On Safari, safariEffectiveRecolourHex distinguishes Dark (#ffffff), Light (none),
    //   and colour themes, replacing the old recolourHex-only distinction.
    const contentKey = `${pageNumber}-${renderErosions}-${cssFilter ?? ""}-${(isSafari ? safariEffectiveRecolourHex : recolourHex) ?? ""}-${renderVersion ?? 0}-${layersVersionRef.current}`;

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
      isSafari ? safariEffectiveRecolourHex : recolourHex,
      renderVersion,
    );
    const cachedData = isSafari ? renderCache.get(cacheKey) : null;

    if (cachedData && isSafari) {
      // Cache hit — drawImage with ImageBitmap is GPU-composited, essentially instant.
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
        ctx.drawImage(cachedData, 0, 0);
      }
      onPageRenderSuccess();
      return;
    }

    // Only signal loading if params actually changed (not just a re-render)
    const currentParams = `${pageNumber}-${renderErosions}-${renderWidth}-${renderHeight}-${(isSafari ? safariEffectiveRecolourHex : recolourHex) ?? ""}-${renderVersion ?? 0}`;
    if (lastRenderedParams.current !== currentParams) {
      onPageRenderStart();
      lastRenderedParams.current = currentParams;
    }

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
        if (isSafari) {
          // Safari path: hand off pixel processing to a dedicated Web Worker so
          // the main thread stays responsive while erosion + enhancement runs.
          const thisRenderId = ++renderIdRef.current;
          const rawImageData = ctx.getImageData(0, 0, renderWidth, renderHeight);
          // Transfer ownership of the buffer to the worker (zero-copy).
          const request: PixelProcessRequest = {
            id: thisRenderId,
            buffer: rawImageData.data.buffer,
            width: renderWidth,
            height: renderHeight,
            erosions: renderErosions,
            // Use safariEffectiveRecolourHex so Dark theme is handled as
            // pixel-level inversion (recolour-to-white) rather than a
            // container CSS filter.
            recolourHex: safariEffectiveRecolourHex ?? undefined,
          };
          const worker = getWorker();
          worker.onmessage = (e: MessageEvent<PixelProcessResponse>) => {
            const { id, bitmap } = e.data;
            // Discard stale responses from a superseded render.
            if (id !== renderIdRef.current) {
              bitmap.close(); // free GPU memory for discarded renders
              return;
            }
            // bitmap was created in the worker — just cache and draw it directly.
            addToCache(cacheKey, bitmap);
            // Only update canvas dimensions if they changed to avoid layout shift.
            if (
              visibleCanvas.width !== renderWidth ||
              visibleCanvas.height !== renderHeight
            ) {
              visibleCanvas.width = renderWidth;
              visibleCanvas.height = renderHeight;
            }
            const dest = visibleCanvas.getContext("2d", { alpha: false });
            if (dest) {
              dest.drawImage(bitmap, 0, 0);
            }
            onPageRenderSuccess();
          };
          worker.postMessage(request, [request.buffer]);
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
    // safariEffectiveRecolourHex is derived from recolourHex + themeFilter.
    // On Safari it changes when the theme changes (e.g. Dark ↔ Light) even
    // when recolourHex stays undefined, so it must be listed explicitly.
    // On Chrome it is always undefined and never causes extra rebuilds.
    safariEffectiveRecolourHex,
    renderVersion,
    onPageRenderStart,
    onPageRenderSuccess,
    getWorker,
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
    console.warn(
      `Canvas area ${renderArea} exceeds max area ${maxArea}, scaling by ${scale} instead.`,
    );
  }
  return scale;
}
