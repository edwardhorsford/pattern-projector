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
  colourLift: number,
): string {
  return `${pageNumber}-${erosions}-${width}-${height}-${colourLift}`;
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
    colourLift,
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
  // So on Safari: all processing (erode, push-darks, colourLift floor) is done via pixels.
  // On other browsers: the full chain runs as canvas 2D CSS filters.
  //
  // colourLift is passed into erosionFilter so it appends url(#lift-blacks) on the
  // canvas draw call — keeping the container CSS filter url()-free. This avoids a
  // Safari bug where a url() in the container filter causes the entire filter (including
  // invert) to be silently dropped if the SVG reference can't be resolved briefly.
  const cssFilter = isSafari
    ? undefined // Safari: all processing done via pixels (no CSS filter on canvas)
    : erosionFilter(magnifying ? 0 : erosions, colourLift); // Others: full filter chain via CSS

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

    // Check cache first (Safari only, since non-Safari uses CSS filters)
    const cacheKey = getCacheKey(
      pageNumber,
      renderErosions,
      renderWidth,
      renderHeight,
      isSafari ? colourLift : 0,
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
    const currentParams = `${pageNumber}-${renderErosions}-${renderWidth}-${renderHeight}-${colourLift}`;
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

            // Always apply enhancement (gamma + contrast + floor) for Safari using fast LUT
            enhanceLineQualityFast(result, 2, 1.5, colourLift);

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
    renderViewport,
    layers,
    pdf,
    cssFilter,
    renderErosions,
    renderWidth,
    renderHeight,
    isSafari,
    pageNumber,
    colourLift,
    onPageRenderStart,
    onPageRenderSuccess,
  ]);

  useEffect(() => {
    drawPageOnCanvas();
  }, [drawPageOnCanvas]);

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
