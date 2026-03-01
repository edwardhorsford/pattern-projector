// pdf-high-res-viewport.tsx
// High-resolution overlay for the visible viewport area. Debounces after pan/zoom,
// renders the visible PDF sub-region at full device resolution, and composites it
// on top of the base render so the projected area stays sharp when zoomed in.

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useDocumentContext } from "react-pdf";
import invariant from "tiny-invariant";
import type { PDFPageProxy } from "pdfjs-dist";
import { Matrix } from "ml-matrix";
import { getBounds, getViewportQuad } from "@/_lib/geometry";
import { PDF_TO_CSS_UNITS } from "@/_lib/pixels-per-inch";
import { erosionFilter } from "@/_lib/erode";
import useRenderContext from "@/_hooks/use-render-context";
import { useTransformContext } from "@/_hooks/use-transform-context";
import type {
  PixelProcessRequest,
  PixelProcessResponse,
} from "@/_lib/pixel-processor.worker";

/** How much wider/taller than the visible quad to render, for panning headroom. */
const PADDING_FACTOR = 1.5;

/** Milliseconds to wait after a pan/zoom change before triggering a re-render. */
const DEBOUNCE_MS = 300;

interface Props {
  /** Perspective matrix: maps screen space → pattern space. */
  perspective: Matrix;
  /** Number of the PDF page to render in high resolution. */
  pageNumber: number;
}

/**
 * Absolutely-positioned canvas that renders a high-resolution sub-region of a
 * PDF page on top of the base CustomRenderer canvas. Placed inside the pdf-viewer
 * grid container (which already has position:relative), so its coordinates are in
 * the same "pattern × patternScale" CSS space as the base canvases.
 *
 * Must be rendered inside a react-pdf <Document> context and a RenderContext.Provider.
 */
export default function PdfHighResViewport({ perspective, pageNumber }: Props) {
  const docContext = useDocumentContext();
  invariant(
    docContext,
    "PdfHighResViewport must be rendered inside a react-pdf Document context",
  );
  const { pdf } = docContext;

  const localTransform = useTransformContext();

  const {
    erosions,
    layers,
    magnifying,
    patternScale,
    recolourHex,
    renderVersion,
    showHighResOverlay,
    debugTintHighRes,
    themeFilter,
  } = useRenderContext();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<ReturnType<PDFPageProxy["render"]> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workerRef = useRef<Worker | null>(null);
  /** Monotonically increasing ID so stale Safari worker responses can be discarded. */
  const renderIdRef = useRef(0);
  // Ref so renderHighRes can read the current flag without it being in its dep
  // array. That way toggling the overlay does not recreate the callback and
  // does not re-trigger the debounce (which would cause a 300 ms flash).
  const showHighResOverlayRef = useRef(showHighResOverlay ?? true);
  // Not using a ref here — when the tint is toggled we want a fresh render
  // so the new pixels are drawn with/without the tint applied.

  const isSafari = useMemo(() => {
    const ua = navigator.userAgent.toLowerCase();
    return ua.indexOf("safari") !== -1 && ua.indexOf("chrome") === -1;
  }, []);

  const getWorker = useCallback((): Worker => {
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL("../_lib/pixel-processor.worker", import.meta.url),
      );
    }
    return workerRef.current;
  }, []);

  // Terminate the pixel worker when unmounting.
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // Apply display toggle immediately when the visibility flag changes,
  // without waiting for the next debounced render.
  useEffect(() => {
    showHighResOverlayRef.current = showHighResOverlay ?? true;
    const canvas = canvasRef.current;
    if (canvas)
      canvas.style.display = showHighResOverlayRef.current ? "" : "none";
  }, [showHighResOverlay]);

  const renderHighRes = useCallback(async () => {
    if (!pdf) return;
    if (!showHighResOverlayRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Do NOT hide the canvas here. Keeping the old pixels visible during the
    // async render means the user always sees something sharp (or blurry-base)
    // rather than a black flash. After the await below, all canvas mutations
    // run synchronously so the browser never paints a cleared (black) canvas.

    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;
    const dpr = window.devicePixelRatio;

    // Find which PDF region the screen corners map to in base pattern space.
    const quad = getViewportQuad(
      perspective,
      localTransform,
      screenWidth,
      screenHeight,
    );
    const [tl, br] = getBounds(quad);

    const quadW = br.x - tl.x;
    const quadH = br.y - tl.y;
    if (quadW <= 0 || quadH <= 0) return;

    // Expand region by the padding factor so small pans don't trigger a re-render.
    const padW = (quadW * (PADDING_FACTOR - 1)) / 2;
    const padH = (quadH * (PADDING_FACTOR - 1)) / 2;
    const regionX_pattern = tl.x - padW;
    const regionY_pattern = tl.y - padH;
    const regionW_pattern = quadW * PADDING_FACTOR;
    const regionH_pattern = quadH * PADDING_FACTOR;

    const page = (await pdf.getPage(pageNumber)) as PDFPageProxy;
    const userUnit = page.userUnit || 1;

    // --- Snap to integer CSS pixel grid ---
    // The core alignment invariant: the canvas's left/top CSS position (an
    // integer) and the PDF offsetX/offsetY must agree about where PDF position
    // X=0 sits. If we computed cssLeft = Math.floor(patternX * patternScale)
    // but rendered with offsetX derived from the unfloored patternX, the two
    // would disagree by a sub-pixel amount that changes each pan, causing
    // consecutive high-res tiles to drift relative to each other.
    //
    // Solution: decide the integer CSS pixel boundaries first, then derive all
    // PDF coordinates from those integers. This guarantees the canvas left edge
    // and the PDF rendering origin are identical by construction.
    const pageView = page.getViewport({ scale: 1 });
    const pageW_pattern = pageView.width * PDF_TO_CSS_UNITS * userUnit;
    const pageH_pattern = pageView.height * PDF_TO_CSS_UNITS * userUnit;

    // Clamp within page bounds (float), then snap each edge to integer CSS px.
    const rawLeft = Math.max(0, regionX_pattern) * patternScale;
    const rawTop = Math.max(0, regionY_pattern) * patternScale;
    const rawRight =
      Math.min(regionX_pattern + regionW_pattern, pageW_pattern) * patternScale;
    const rawBottom =
      Math.min(regionY_pattern + regionH_pattern, pageH_pattern) * patternScale;
    const cssLeft = Math.round(rawLeft);
    const cssTop = Math.round(rawTop);
    const cssRight = Math.round(rawRight);
    const cssBottom = Math.round(rawBottom);
    const cssWidth = cssRight - cssLeft;
    const cssHeight = cssBottom - cssTop;
    if (cssWidth <= 0 || cssHeight <= 0) return;

    // Derive PDF region from the snapped integer CSS positions so the render
    // origin matches the canvas placement exactly.
    const cssToPage = 1 / (PDF_TO_CSS_UNITS * userUnit);
    const regionX_pdf = (cssLeft / patternScale) * cssToPage;
    const regionY_pdf = (cssTop / patternScale) * cssToPage;
    const regionW_pdf = (cssWidth / patternScale) * cssToPage;

    // Canvas pixel size: cssWidth CSS pixels × dpr device pixels each.
    // Math.round handles non-integer dpr (e.g. 1.5× on some devices).
    let pixelW = Math.round(cssWidth * dpr);
    let pixelH = Math.round(cssHeight * dpr);

    // Scale that exactly maps this pixel budget onto regionW/H_pdf.
    // Using pixelW/regionW_pdf (rather than the targetScale formula) ensures
    // offsetX = -regionX_pdf * renderScale exactly places regionX_pdf at pixel 0.
    const maxArea = isSafari ? 16_777_216 : 67_108_864;
    if (pixelW * pixelH > maxArea) {
      const factor = Math.sqrt(maxArea / (pixelW * pixelH));
      pixelW = Math.floor(pixelW * factor);
      pixelH = Math.floor(pixelH * factor);
    }
    if (pixelW <= 0 || pixelH <= 0) return;

    const renderScale = pixelW / regionW_pdf;

    // pdf.js sub-region render: offsetX/offsetY shift the content so
    // regionX_pdf lands at canvas pixel 0, matching the canvas's cssLeft position.
    const viewport = page.getViewport({
      scale: renderScale,
      offsetX: -regionX_pdf * renderScale,
      offsetY: -regionY_pdf * renderScale,
    });

    // Cancel any in-flight render before starting a new one.
    // renderVersion is read here so changes to it (file reload, line weight
    // change) cause the useCallback to be recreated and the debounce effect
    // to fire a fresh render.
    void renderVersion;
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
    }
    page.cleanup();

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = pixelW;
    tempCanvas.height = pixelH;
    const ctx = tempCanvas.getContext("2d", {
      alpha: false,
      willReadFrequently: isSafari,
    });
    if (!ctx) return;

    // Respect optional content layer visibility.
    const optionalContentConfig = await pdf.getOptionalContentConfig();
    for (const layer of Object.values(layers)) {
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
      // Render was cancelled or an error occurred — leave the existing canvas in place.
      return;
    }

    // Build the same post-processing config as CustomRenderer uses.
    const useRecolour = !!recolourHex && !isSafari;
    const renderErosions = isSafari ? (magnifying ? 0 : erosions) : 0;
    const safariEffectiveRecolourHex = isSafari
      ? recolourHex ?? (themeFilter === "invert(1)" ? "#ffffff" : undefined)
      : undefined;
    const cssFilter = isSafari
      ? undefined
      : [
          erosionFilter(magnifying ? 0 : erosions, useRecolour),
          themeFilter && themeFilter !== "none" ? themeFilter : undefined,
        ]
          .filter(Boolean)
          .join(" ");

    // CSS filter for the debug amber tint (applied to the canvas element itself,
    // not to the pixel data).
    // invert(1): white bg → black, black lines → white.
    // brightness(0.5): bring white lines to mid-grey so sepia has room to colourise
    //   (sepia on near-white saturates immediately to the ceiling, losing hue).
    // sepia(1) → saturate(10) → hue-rotate(15deg): push mid-grey warm tones to
    //   vivid amber (~H53, S100%), close to the amber theme primary colour.
    const debugFilter = debugTintHighRes
      ? // ? "brightness(1.0) sepia(1) saturate(10) hue-rotate(15deg)"
        "invert(1) brightness(1.0) sepia(1) saturate(10) hue-rotate(15deg)"
      : "";

    // cssLeft/Top/Width/Height are integer CSS pixels derived from snapped
    // region boundaries — computed earlier in the coordinate section.

    if (isSafari) {
      // Safari: pixel worker is async. Do NOT touch canvas.width/height here —
      // assigning them clears the canvas to black and there would be a visible
      // blank gap until the worker callback fires. Instead, pass all the values
      // as captured locals and resize+draw atomically inside the callback.
      const thisRenderId = ++renderIdRef.current;
      const rawImageData = ctx.getImageData(0, 0, pixelW, pixelH);
      const request: PixelProcessRequest = {
        id: thisRenderId,
        buffer: rawImageData.data.buffer,
        width: pixelW,
        height: pixelH,
        erosions: renderErosions,
        recolourHex: safariEffectiveRecolourHex ?? undefined,
      };
      const worker = getWorker();
      worker.onmessage = (e: MessageEvent<PixelProcessResponse>) => {
        const { id, bitmap } = e.data;
        if (id !== renderIdRef.current) {
          bitmap.close();
          return;
        }
        // Resize, position and draw in one synchronous block so the browser
        // never paints a cleared (blank) canvas between resize and drawImage.
        canvas.width = pixelW;
        canvas.height = pixelH;
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
        canvas.style.left = `${cssLeft}px`;
        canvas.style.top = `${cssTop}px`;
        canvas.style.filter = debugFilter;
        const dest = canvas.getContext("2d", { alpha: false });
        if (dest) {
          dest.drawImage(bitmap, 0, 0);
        }
        bitmap.close();
        canvas.style.display = showHighResOverlayRef.current ? "" : "none";
      };
      worker.postMessage(request, [request.buffer]);
    } else {
      // Chrome/Firefox: resize, draw and show in one synchronous block.
      // canvas.width clears the canvas, but drawImage follows immediately
      // so the browser never paints the cleared state.
      canvas.width = pixelW;
      canvas.height = pixelH;
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      canvas.style.left = `${cssLeft}px`;
      canvas.style.top = `${cssTop}px`;
      const dest = canvas.getContext("2d");
      if (!dest) return;
      dest.imageSmoothingEnabled = false;
      dest.filter = cssFilter ?? "none";
      dest.drawImage(tempCanvas, 0, 0);
      canvas.style.filter = debugFilter;
      canvas.style.display = showHighResOverlayRef.current ? "" : "none";
    }
  }, [
    pdf,
    perspective,
    localTransform,
    pageNumber,
    patternScale,
    erosions,
    layers,
    magnifying,
    recolourHex,
    renderVersion,
    // showHighResOverlay intentionally omitted — read via showHighResOverlayRef
    // so toggling visibility does not recreate this callback or trigger a render.
    debugTintHighRes,
    themeFilter,
    isSafari,
    getWorker,
  ]);

  // Debounce render triggers so fast pan/zoom sequences don't queue up many renders.
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      renderHighRes();
    }, DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [renderHighRes]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        imageRendering: "pixelated",
        pointerEvents: "none",
      }}
    />
  );
}
