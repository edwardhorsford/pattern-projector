// pdf-loupe.tsx
// Circular high-resolution loupe overlay. Listens for "loupe-point" custom events
// (screen-space Point coordinates) fired by MeasureCanvas when hovering or dragging
// a line endpoint, and renders a magnified inset of the PDF centred on that point.
//
// The canvas is position:fixed in the browser viewport, offset above the endpoint
// so it doesn't obstruct the pointer. A gapped crosshair marks the centre of the
// viewed region so the user can place the endpoint pixel-accurately.
//
// Rendering mirrors the non-magnified path in PdfHighResViewport: pdf.js rasterises
// a small tile; Chrome applies post-processing as CSS filters; Safari routes pixels
// through the pixel worker. The tile is small (~240px at DPR) so renders are fast
// even on Safari.

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useDocumentContext } from "react-pdf";
import invariant from "tiny-invariant";
import type { PDFPageProxy } from "pdfjs-dist";
import { Matrix } from "ml-matrix";
import { inverse } from "ml-matrix";
import { transformPoint } from "@/_lib/geometry";
import { PDF_TO_CSS_UNITS } from "@/_lib/pixels-per-inch";
import { erosionFilter } from "@/_lib/erode";
import useRenderContext from "@/_hooks/use-render-context";
import { getScale } from "@/_components/pdf-custom-renderer";
import { useTransformContext } from "@/_hooks/use-transform-context";
import type { Point } from "@/_lib/point";
import type {
  PixelProcessRequest,
  PixelProcessResponse,
} from "@/_lib/pixel-processor.worker";

/** Displayed diameter of the loupe in CSS px (the visible circle). */
export const LOUPE_DISPLAY_PX = 200;

/**
 * How many times to magnify the PDF region. A value of 4 means the loupe
 * shows a region that is LOUPE_DISPLAY_PX / LOUPE_ZOOM = 50 CSS px wide.
 */
const LOUPE_ZOOM = 6;

/**
 * Gap in CSS px between the endpoint centre and the nearest edge of the
 * loupe circle — i.e. the endpoint hover circle (~30px radius) plus a
 * small visual margin.
 */
export const LOUPE_GAP = 16;

/** Minimum distance from any screen edge before the loupe flips sides. */
export const SCREEN_MARGIN = 12;

/** Custom event name fired by MeasureCanvas. */
export const LOUPE_POINT_EVENT = "loupe-point";

interface Props {
  /** Perspective matrix: maps screen space → pattern space. */
  perspective: Matrix;
  /** Calibration transform: maps pattern space → screen space. */
  calibrationTransform?: Matrix;
  /** PDF page number to render (1-based). */
  pageNumber: number;
  /** Horizontal offset of this page's top-left in the grid container at patternScale=1. */
  pageOffsetXBase?: number;
  /** Vertical offset of this page's top-left in the grid container at patternScale=1. */
  pageOffsetYBase?: number;
}

/**
 * Renders a circular high-resolution loupe at a fixed viewport position above
 * the current line endpoint. Mounts as a null-render React component that
 * imperatively manages its own canvas element appended to document.body.
 *
 * Must be rendered inside a react-pdf <Document> context and a RenderContext.Provider.
 */
export default function PdfLoupe({
  perspective,
  pageNumber,
  pageOffsetXBase = 0,
  pageOffsetYBase = 0,
}: Props) {
  const docContext = useDocumentContext();
  invariant(
    docContext,
    "PdfLoupe must be rendered inside a react-pdf Document context",
  );
  const { pdf } = docContext;

  const localTransform = useTransformContext();

  const {
    erosions,
    layers,
    patternScale,
    recolourHex,
    renderVersion,
    themeFilter,
  } = useRenderContext();

  // The loupe uses a wrapper div (for position, clip, border) containing the canvas.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<ReturnType<PDFPageProxy["render"]> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const renderIdRef = useRef(0);

  /** True while a pdf.js render or Safari worker is in-flight. */
  const isRenderingRef = useRef(false);
  /** Set to the latest requested point when a render arrives while one is
   *  already in-flight. The in-flight render checks this on completion and
   *  schedules a follow-up so no request is silently dropped. */
  const needsRenderRef = useRef<Point | null>(null);
  /** Velocity tracking for adaptive debounce. */
  const lastEventPointRef = useRef<Point | null>(null);
  const lastEventTimeRef = useRef<number>(0);

  // Stable refs so renderLoupe (the async function) always reads the latest values
  // without needing to be recreated on every prop/state change.
  const perspectiveRef = useRef(perspective);
  perspectiveRef.current = perspective;
  const localTransformRef = useRef(localTransform);
  localTransformRef.current = localTransform;
  const erosionsRef = useRef(erosions);
  erosionsRef.current = erosions;
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const patternScaleRef = useRef(patternScale);
  patternScaleRef.current = patternScale;
  const recolourHexRef = useRef(recolourHex);
  recolourHexRef.current = recolourHex;
  const renderVersionRef = useRef(renderVersion);
  renderVersionRef.current = renderVersion;
  const themeFilterRef = useRef(themeFilter);
  themeFilterRef.current = themeFilter;
  const pageOffsetXBaseRef = useRef(pageOffsetXBase);
  pageOffsetXBaseRef.current = pageOffsetXBase;
  const pageOffsetYBaseRef = useRef(pageOffsetYBase);
  pageOffsetYBaseRef.current = pageOffsetYBase;
  const pdfRef = useRef(pdf);
  pdfRef.current = pdf;

  const isSafari = useMemo(() => {
    const ua = navigator.userAgent.toLowerCase();
    return ua.indexOf("safari") !== -1 && ua.indexOf("chrome") === -1;
  }, []);

  const isSafariRef = useRef(isSafari);
  isSafariRef.current = isSafari;

  const getWorker = useCallback((): Worker => {
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL("../_lib/pixel-processor.worker", import.meta.url),
      );
    }
    return workerRef.current;
  }, []);

  /**
   * Returns (or creates) the wrapper container div and the inner canvas.
   * The container div handles position, circular clip, border and shadow.
   * The canvas fills it and is the actual drawing surface.
   * Using overflow:hidden on a div is the only reliable way to clip canvas
   * content to a circle — border-radius alone does not clip canvas pixels.
   */
  const getOrCreateContainer = useCallback((): {
    container: HTMLDivElement;
    canvas: HTMLCanvasElement;
  } => {
    if (containerRef.current && canvasRef.current) {
      return { container: containerRef.current, canvas: canvasRef.current };
    }

    const container = document.createElement("div");
    container.style.position = "fixed";
    container.style.width = `${LOUPE_DISPLAY_PX}px`;
    container.style.height = `${LOUPE_DISPLAY_PX}px`;
    container.style.borderRadius = "50%";
    container.style.overflow = "hidden";
    container.style.border = "2px solid rgba(255,255,255,0.7)";
    container.style.boxShadow = "0 2px 16px rgba(0,0,0,0.5)";
    container.style.pointerEvents = "none";
    container.style.zIndex = "60";
    container.style.display = "none";
    container.style.boxSizing = "content-box";
    // Forces a GPU compositing layer — required for overflow:hidden + border-radius
    // to reliably clip canvas content in Chrome.
    container.style.transform = "translateZ(0)";

    const canvas = document.createElement("canvas");
    canvas.style.display = "block";
    canvas.style.width = `${LOUPE_DISPLAY_PX}px`;
    canvas.style.height = `${LOUPE_DISPLAY_PX}px`;
    canvas.style.imageRendering = "pixelated";

    container.appendChild(canvas);
    document.body.appendChild(container);
    containerRef.current = container;
    canvasRef.current = canvas;
    return { container, canvas };
  }, []);

  const removeContainer = useCallback(() => {
    containerRef.current?.remove();
    containerRef.current = null;
    canvasRef.current = null;
  }, []);

  // Clean up on unmount.
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      removeContainer();
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [removeContainer]);

  // ---------------------------------------------------------------
  // renderLoupe — renders a magnified inset of the PDF centred on
  // the provided screen point. Designed to be called from a stable
  // ref so it always operates on the latest prop/state values.
  // ---------------------------------------------------------------

  /**
   * Positions the loupe container at the best corner relative to the screen
   * point. Defaults to top-right; flips to left or bottom near screen edges.
   * Called immediately on every loupe-point event so the loupe tracks the
   * endpoint position without waiting for the async pdf.js render.
   */
  const snapCanvasPosition = useCallback(
    (screenPoint: Point) => {
      const { container } = getOrCreateContainer();
      const nearRight =
        screenPoint.x + LOUPE_GAP + LOUPE_DISPLAY_PX + SCREEN_MARGIN >
        window.innerWidth;
      const nearTop =
        screenPoint.y - LOUPE_GAP - LOUPE_DISPLAY_PX < SCREEN_MARGIN;

      const left = nearRight
        ? screenPoint.x - LOUPE_GAP - LOUPE_DISPLAY_PX
        : screenPoint.x + LOUPE_GAP;
      const top = nearTop
        ? screenPoint.y + LOUPE_GAP
        : screenPoint.y - LOUPE_DISPLAY_PX - LOUPE_GAP;

      container.style.left = `${Math.round(left)}px`;
      container.style.top = `${Math.round(top)}px`;
    },
    [getOrCreateContainer],
  );

  const snapCanvasPositionRef = useRef(snapCanvasPosition);
  snapCanvasPositionRef.current = snapCanvasPosition;

  /**
   * Called when a render finishes (successfully or via Safari worker). Clears
   * the in-flight flag and, if another point arrived while we were busy,
   * schedules a fresh render so no request is silently dropped.
   */
  const finishRender = useCallback(() => {
    isRenderingRef.current = false;
    const pending = needsRenderRef.current;
    if (pending) {
      needsRenderRef.current = null;
      setTimeout(() => renderLoupeRef.current?.(pending), 0);
    }
  }, []);

  const finishRenderRef = useRef(finishRender);
  finishRenderRef.current = finishRender;

  const renderLoupe = useCallback(
    async (screenPoint: Point) => {
      const currentPdf = pdfRef.current;
      if (!currentPdf) return;

      if (isRenderingRef.current) {
        needsRenderRef.current = screenPoint;
        return;
      }

      const currentDpr = isSafariRef.current
        ? Math.min(window.devicePixelRatio, 1)
        : window.devicePixelRatio;
      const pixelSize = Math.round(LOUPE_DISPLAY_PX * currentDpr);

      const currentPerspective = perspectiveRef.current;
      const currentLocalTransform = localTransformRef.current;
      const currentPatternScale = patternScaleRef.current;
      const currentErosions = erosionsRef.current;
      const currentLayers = layersRef.current;
      const currentRecolourHex = recolourHexRef.current;
      const currentThemeFilter = themeFilterRef.current;
      const currentPageOffsetXBase = pageOffsetXBaseRef.current;
      const currentPageOffsetYBase = pageOffsetYBaseRef.current;

      // Map the screen point to grid-container CSS coordinates.
      // This mirrors the single-point version of getViewportQuad:
      //   screen → pattern space (via perspective) → grid CSS (undo localTransform).
      const calibratedPoint = transformPoint(screenPoint, currentPerspective);
      const gridCssPt = transformPoint(
        calibratedPoint,
        inverse(currentLocalTransform),
      );

      // Radius of the viewed region in grid-CSS px at the requested zoom factor.
      const radiusCss = LOUPE_DISPLAY_PX / 2 / LOUPE_ZOOM;

      const pageOriginX = currentPageOffsetXBase * currentPatternScale;
      const pageOriginY = currentPageOffsetYBase * currentPatternScale;

      const page = (await currentPdf.getPage(pageNumber)) as PDFPageProxy;
      const userUnit = page.userUnit || 1;
      const pageView = page.getViewport({ scale: 1 });
      const pageWidthCss =
        pageView.width * PDF_TO_CSS_UNITS * userUnit * currentPatternScale;
      const pageHeightCss =
        pageView.height * PDF_TO_CSS_UNITS * userUnit * currentPatternScale;

      // Clamp the region to page bounds.
      const rawLeft = Math.max(pageOriginX, gridCssPt.x - radiusCss);
      const rawRight = Math.min(
        pageOriginX + pageWidthCss,
        gridCssPt.x + radiusCss,
      );
      const rawTop = Math.max(pageOriginY, gridCssPt.y - radiusCss);
      const rawBottom = Math.min(
        pageOriginY + pageHeightCss,
        gridCssPt.y + radiusCss,
      );

      const { container, canvas } = getOrCreateContainer();

      if (rawRight <= rawLeft || rawBottom <= rawTop) {
        // Screen point is outside this page's bounds — hide this instance.
        container.style.display = "none";
        finishRenderRef.current();
        return;
      }

      const cssWidth = rawRight - rawLeft;

      const cssToPage = 1 / (PDF_TO_CSS_UNITS * userUnit);
      const regionXPdf =
        ((rawLeft - pageOriginX) / currentPatternScale) * cssToPage;
      const regionYPdf =
        ((rawTop - pageOriginY) / currentPatternScale) * cssToPage;
      const regionWPdf = (cssWidth / currentPatternScale) * cssToPage;

      const renderScale = pixelSize / regionWPdf;

      // Bail if the loupe wouldn't be sharper than the base render.
      const baseScale = getScale(
        pageView.width,
        pageView.height,
        userUnit,
        isSafariRef.current,
        false,
      );
      if (renderScale <= baseScale) {
        container.style.display = "none";
        finishRenderRef.current();
        return;
      }

      isRenderingRef.current = true;
      const thisRenderId = ++renderIdRef.current;

      const viewport = page.getViewport({
        scale: renderScale,
        offsetX: -regionXPdf * renderScale,
        offsetY: -regionYPdf * renderScale,
      });

      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
      page.cleanup();

      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = pixelSize;
      tempCanvas.height = pixelSize;
      const ctx = tempCanvas.getContext("2d", {
        alpha: false,
        willReadFrequently: isSafariRef.current,
      });
      if (!ctx) {
        finishRenderRef.current();
        return;
      }

      const optionalContentConfig = await currentPdf.getOptionalContentConfig();
      for (const layer of Object.values(currentLayers)) {
        for (const id of layer.ids) {
          optionalContentConfig.setVisibility(id, layer.visible);
        }
      }

      const renderTask = page.render({
        canvasContext: ctx as any,
        viewport,
        optionalContentConfigPromise: Promise.resolve(optionalContentConfig),
      });
      renderTaskRef.current = renderTask;

      try {
        await renderTask.promise;
      } catch (_e) {
        finishRenderRef.current();
        return;
      }

      if (thisRenderId !== renderIdRef.current) {
        finishRenderRef.current();
        return;
      }

      // Post-processing parameters.
      const scaleRatio = renderScale / baseScale;
      const effectiveErosionsChrome = Math.round(currentErosions * scaleRatio);
      const useRecolour = !!currentRecolourHex && !isSafariRef.current;
      const cssFilter = isSafariRef.current
        ? undefined
        : [
            erosionFilter(effectiveErosionsChrome, useRecolour),
            currentThemeFilter && currentThemeFilter !== "none"
              ? currentThemeFilter
              : undefined,
          ]
            .filter(Boolean)
            .join(" ");
      const safariRecolourHex = isSafariRef.current
        ? currentRecolourHex ??
          (currentThemeFilter === "invert(1)" ? "#ffffff" : undefined)
        : undefined;

      /**
       * Commits the rendered image to the visible canvas and draws the crosshair.
       * Accepts either a canvas or an ImageBitmap produced by the Safari pixel worker.
       */
      const commit = (source: CanvasImageSource) => {
        if (thisRenderId !== renderIdRef.current) return;

        canvas.width = pixelSize;
        canvas.height = pixelSize;

        const dest = canvas.getContext("2d", { alpha: false });
        if (!dest) return;

        if (!isSafariRef.current) {
          dest.imageSmoothingEnabled = false;
          dest.filter = cssFilter ?? "none";
        }

        dest.drawImage(source, 0, 0);

        // Draw gapped crosshair over the committed PDF content.
        dest.save();
        dest.filter = "none";
        dest.imageSmoothingEnabled = false;

        const centreX = pixelSize / 2;
        const centreY = pixelSize / 2;
        const armLength = Math.round(14 * currentDpr);
        const armGap = Math.round(3 * currentDpr);

        // Dark shadow pass for visibility on light content.
        dest.strokeStyle = "rgba(0, 0, 0, 0.5)";
        dest.lineWidth = 2.5 * currentDpr;
        dest.beginPath();
        dest.moveTo(centreX - armLength, centreY);
        dest.lineTo(centreX - armGap, centreY);
        dest.moveTo(centreX + armGap, centreY);
        dest.lineTo(centreX + armLength, centreY);
        dest.moveTo(centreX, centreY - armLength);
        dest.lineTo(centreX, centreY - armGap);
        dest.moveTo(centreX, centreY + armGap);
        dest.lineTo(centreX, centreY + armLength);
        dest.stroke();

        // Bright coloured pass.
        dest.strokeStyle = "rgba(255, 50, 50, 0.9)";
        dest.lineWidth = 1.5 * currentDpr;
        dest.beginPath();
        dest.moveTo(centreX - armLength, centreY);
        dest.lineTo(centreX - armGap, centreY);
        dest.moveTo(centreX + armGap, centreY);
        dest.lineTo(centreX + armLength, centreY);
        dest.moveTo(centreX, centreY - armLength);
        dest.lineTo(centreX, centreY - armGap);
        dest.moveTo(centreX, centreY + armGap);
        dest.lineTo(centreX, centreY + armLength);
        dest.stroke();

        dest.restore();

        // Position is already snapped by snapCanvasPosition — make container visible.
        container.style.display = "";
      };

      if (isSafariRef.current) {
        const rawImageData = ctx.getImageData(0, 0, pixelSize, pixelSize);
        const request: PixelProcessRequest = {
          id: thisRenderId,
          buffer: rawImageData.data.buffer,
          width: pixelSize,
          height: pixelSize,
          erosions: currentErosions,
          recolourHex: safariRecolourHex ?? undefined,
        };
        const worker = getWorker();
        worker.onmessage = (event: MessageEvent<PixelProcessResponse>) => {
          const { id, bitmap } = event.data;
          if (id !== renderIdRef.current) {
            bitmap.close();
            finishRenderRef.current();
            return;
          }
          commit(bitmap);
          bitmap.close();
          finishRenderRef.current();
        };
        worker.postMessage(request, [request.buffer]);
      } else {
        commit(tempCanvas);
        finishRenderRef.current();
      }
    },
    [pageNumber, getOrCreateContainer, getWorker],
  );

  // Stable ref so the event handler (registered once on mount) always calls the
  // latest renderLoupe without needing to re-register.
  const renderLoupeRef = useRef(renderLoupe);
  renderLoupeRef.current = renderLoupe;

  // Listen for loupe-point events dispatched by MeasureCanvas.
  useEffect(() => {
    const handleLoupePoint = (event: Event) => {
      const screenPoint = (event as CustomEvent<Point | null>).detail;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }

      if (!screenPoint) {
        // Endpoint released or pointer left — hide this instance's container.
        renderIdRef.current++;
        isRenderingRef.current = false;
        needsRenderRef.current = null;
        lastEventPointRef.current = null;
        const container = containerRef.current;
        if (container) container.style.display = "none";
        return;
      }

      // 1. Snap container position immediately so the loupe follows the
      //    endpoint without waiting for the async render to complete.
      snapCanvasPositionRef.current(screenPoint);

      // 2. Velocity-adaptive debounce: fire immediately when slow/stopped,
      //    defer briefly during fast movement to avoid wasted renders.
      const now = Date.now();
      const prevPt = lastEventPointRef.current;
      const dt = now - lastEventTimeRef.current;
      let speedPxPerMs = 0;
      if (prevPt && dt > 0) {
        const dx = screenPoint.x - prevPt.x;
        const dy = screenPoint.y - prevPt.y;
        speedPxPerMs = Math.sqrt(dx * dx + dy * dy) / dt;
      }
      lastEventPointRef.current = screenPoint;
      lastEventTimeRef.current = now;

      // Fast movement (>2px/ms): 80ms wait — still tracks but avoids
      // triggering a render every pointer event during a fast drag.
      // Moderate (>0.5px/ms): 30ms.
      // Slow/stopped: fire immediately.
      const debounceMs = speedPxPerMs > 2 ? 80 : speedPxPerMs > 0.5 ? 30 : 0;

      if (debounceMs === 0) {
        renderLoupeRef.current(screenPoint);
      } else {
        debounceTimerRef.current = setTimeout(() => {
          renderLoupeRef.current(screenPoint);
        }, debounceMs);
      }
    };

    document.addEventListener(LOUPE_POINT_EVENT, handleLoupePoint);
    return () =>
      document.removeEventListener(LOUPE_POINT_EVENT, handleLoupePoint);
  }, []);

  // PdfLoupe renders nothing into the React tree — the canvas is imperative.
  return null;
}
