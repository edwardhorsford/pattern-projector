// pdf-high-res-viewport.tsx
// High-resolution overlay for the visible viewport area. Debounces after pan/zoom,
// renders the visible PDF sub-region at full device resolution, and composites it
// on top of the base render so the projected area stays sharp when zoomed in.
//
// Normal mode: canvas positioned inside the grid container (grid-space CSS).
// Magnify mode: a SEPARATE canvas appended to document.body in screen space,
// bypassing all CSS transform chains so the compositor preserves the full
// backing-store resolution. The PDF content is drawn at the correct screen
// position using ctx.setTransform() with the accumulated cal × mag × local matrix.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { useDocumentContext } from "react-pdf";
import invariant from "tiny-invariant";
import type { PDFPageProxy } from "pdfjs-dist";
import { inverse, Matrix } from "ml-matrix";
import { getBounds, getViewportQuad } from "@/_lib/geometry";
import { PDF_TO_CSS_UNITS } from "@/_lib/pixels-per-inch";
import { erosionFilter } from "@/_lib/erode";
import useRenderContext from "@/_hooks/use-render-context";
import { getScale } from "@/_components/pdf-custom-renderer";
import { useTransformContext } from "@/_hooks/use-transform-context";
import type {
  PixelProcessRequest,
  PixelProcessResponse,
} from "@/_lib/pixel-processor.worker";

/**
 * How much wider/taller than the visible quad to render, for panning headroom.
 * Chrome renders fast — a larger tile means panning rarely exposes the base canvas.
 * Safari renders slowly via the CPU pixel worker — keep the tile small so each
 * render completes quickly.
 */
const CHROME_PADDING_FACTOR = 3;
const SAFARI_PADDING_FACTOR = 1.5;

/**
 * When checking whether to skip a re-render because the viewport is still within
 * the existing tile, require at least this fraction of the tile's dimension as
 * clearance on every side. Ensures a new tile is queued before the user reaches
 * the edge of the current one.
 */
const MIN_TILE_MARGIN_FRACTION = 0.15;

/** Milliseconds to wait after a pan/zoom change before triggering a re-render. */
const DEBOUNCE_MS = 300;

// NOTE: the previous STALE_TILE_MS safety timer was removed. It forced a full
// re-render every 2 s even when the tile was valid, which hammered the Safari
// pixel worker (2–10 s per render). The tile-skip check already verifies
// renderVersion, so content changes are already captured.

interface Props {
  /** Perspective matrix: maps screen space → pattern space. */
  perspective: Matrix;
  /** Number of the PDF page to render in high resolution. */
  pageNumber: number;
  /**
   * Horizontal offset of this page's top-left corner within the grid container,
   * in CSS px at patternScale=1. Multiplied by patternScale internally to get
   * the actual CSS offset. Defaults to 0 (first/only page).
   */
  pageOffsetXBase?: number;
  /** Vertical offset of this page within the grid container, CSS px at patternScale=1. */
  pageOffsetYBase?: number;
  /**
   * CSS-only magnify transform (scaleAboutPoint). When present, the overlay
   * switches to a body-level canvas positioned in screen space so the
   * compositor preserves the full backing-store resolution.
   */
  magnifyTransform?: Matrix | null;
}

/**
 * Absolutely-positioned canvas that renders a high-resolution sub-region of a
 * PDF page on top of the base CustomRenderer canvas. Placed inside the pdf-viewer
 * grid container (which already has position:relative), so its coordinates are in
 * the same "pattern × patternScale" CSS space as the base canvases.
 *
 * When magnified, a second canvas is appended directly to document.body and
 * positioned in screen space to bypass the CSS magnify transform chain. This
 * prevents the browser compositor from down-sampling the backing store into the
 * parent layer's texture at the small pre-magnify CSS box size.
 *
 * Must be rendered inside a react-pdf <Document> context and a RenderContext.Provider.
 */
export default function PdfHighResViewport({
  perspective,
  pageNumber,
  pageOffsetXBase = 0,
  pageOffsetYBase = 0,
  magnifyTransform = null,
}: Props) {
  const docContext = useDocumentContext();
  invariant(
    docContext,
    "PdfHighResViewport must be rendered inside a react-pdf Document context",
  );
  const { pdf } = docContext;

  const localTransform = useTransformContext();

  const {
    debugLowResBase,
    erosions,
    layers,
    patternScale,
    recolourHex,
    renderVersion,
    showHighResOverlay,
    debugTintHighRes,
    themeFilter,
  } = useRenderContext();

  // Grid-space canvas (used when NOT magnified).
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Body-level canvas (used when magnified). Created/destroyed imperatively.
  const magnifyCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const renderTaskRef = useRef<ReturnType<PDFPageProxy["render"]> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // staleTileTimerRef removed — stale timer was causing redundant expensive
  // re-renders on Safari. The tile-skip check + renderVersion is sufficient.
  const workerRef = useRef<Worker | null>(null);
  /** Monotonically increasing ID so stale Safari worker responses can be discarded. */
  const renderIdRef = useRef(0);
  /** True while a render is in-flight (pdf.js rendering or Safari pixel worker
   *  processing). Prevents a second render from starting and bumping renderIdRef
   *  — which would invalidate the in-flight worker's result on completion. */
  const isRenderingRef = useRef(false);
  /** Set to true when a render request arrives while isRenderingRef is true.
   *  When the in-flight render completes, it checks this flag and schedules
   *  a fresh render if set — so no request is ever silently dropped. */
  const needsRenderRef = useRef(false);
  // Ref so renderHighRes can read the current flag without it being in its dep
  // array. That way toggling the overlay does not recreate the callback and
  // does not re-trigger the debounce (which would cause a 300 ms flash).
  const showHighResOverlayRef = useRef(showHighResOverlay ?? true);

  // Track the patternScale and CSS position of the last committed tile so we
  // can apply a compensating CSS transform when patternScale changes. This keeps
  // the overlay pixel-for-pixel aligned with the base canvas during a zoom
  // animation, without needing a full re-render. renderHighRes clears the
  // transform once it writes the correct CSS values for the new scale.
  const renderedPatternScaleRef = useRef<number | null>(null);
  const renderedCssLeftRef = useRef(0);
  const renderedCssTopRef = useRef(0);
  // Content key captures all visual parameters so tile-skip detects any
  // change — not just patternScale / renderVersion.
  const renderedContentKeyRef = useRef<string | null>(null);
  // Tile dimensions in grid-container CSS space for the tile-skip check.
  const renderedTileWidthRef = useRef(0);
  const renderedTileHeightRef = useRef(0);
  // Tracks whether the previous render was magnified so we can detect
  // transitions (null↔non-null) and invalidate the stale tile.
  const wasMagnifiedRef = useRef(false);
  // Always reflects the latest patternScale so async render completions can
  // check whether their scale is still current before committing CSS values.
  const currentPatternScaleRef = useRef(patternScale);
  // Assign during render (not in a useEffect) so the ref is updated before any
  // async callbacks can run — closing the window where a stale render sees an
  // outdated value.
  currentPatternScaleRef.current = patternScale;

  // Track layers object identity so we can include it in the content key
  // without serialising the whole object on every render call.
  const layersRef = useRef(layers);
  const layersVersionRef = useRef(0);
  if (layersRef.current !== layers) {
    layersRef.current = layers;
    layersVersionRef.current++;
  }

  // --- Magnify compositing cache ---
  // The rendered tile (sourceCanvas) and its grid-space bounds are cached here
  // so that panning only requires a cheap drawImage + setTransform, not a full
  // pdf.js re-render. renderHighRes updates this; the compositing effect reads it.
  const cachedTileRef = useRef<{
    canvas: HTMLCanvasElement;
    cssLeft: number;
    cssTop: number;
    cssWidth: number;
    cssHeight: number;
    cssFilter: string | undefined;
    debugFilter: string;
    screenCanvasW: number;
    screenCanvasH: number;
    screenWidth: number;
    screenHeight: number;
    dpr: number;
  } | null>(null);

  // Always-current refs for values that the compositing effect needs to read
  // without being in its dependency array (to avoid recreating it every frame).
  const localTransformRef = useRef(localTransform);
  localTransformRef.current = localTransform;
  const magnifyTransformRef = useRef(magnifyTransform);
  magnifyTransformRef.current = magnifyTransform;
  const perspectiveRef = useRef(perspective);
  perspectiveRef.current = perspective;

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

  /**
   * Returns (or creates) the body-level magnify canvas. Appended to
   * document.body so it sits outside all CSS transform chains.
   */
  const getOrCreateMagnifyCanvas = useCallback((): HTMLCanvasElement => {
    if (!magnifyCanvasRef.current) {
      const c = document.createElement("canvas");
      c.style.position = "fixed";
      c.style.left = "0";
      c.style.top = "0";
      c.style.pointerEvents = "none";
      c.style.imageRendering = "pixelated";
      // z-index high enough to sit above the Draggable content but below
      // interactive UI (menus are z-40+).
      c.style.zIndex = "35";
      document.body.appendChild(c);
      magnifyCanvasRef.current = c;
    }
    return magnifyCanvasRef.current;
  }, []);

  /** Hides and detaches the body-level magnify canvas if it exists. */
  const removeMagnifyCanvas = useCallback(() => {
    if (magnifyCanvasRef.current) {
      magnifyCanvasRef.current.remove();
      magnifyCanvasRef.current = null;
    }
  }, []);

  // Terminate the pixel worker and remove body canvas when unmounting.
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      removeMagnifyCanvas();
      cachedTileRef.current = null;
    };
  }, [removeMagnifyCanvas]);

  // Apply display toggle immediately when the visibility flag changes,
  // without waiting for the next debounced render.
  useEffect(() => {
    showHighResOverlayRef.current = showHighResOverlay ?? true;
    const canvas = canvasRef.current;
    if (canvas)
      canvas.style.display = showHighResOverlayRef.current ? "" : "none";
    if (magnifyCanvasRef.current)
      magnifyCanvasRef.current.style.display = showHighResOverlayRef.current
        ? ""
        : "none";
  }, [showHighResOverlay]);

  // useLayoutEffect (not useEffect) so the transform is applied synchronously
  // after DOM commit and before the browser paints — prevents a flash frame
  // where the canvas appears at the wrong position.
  useLayoutEffect(() => {
    // Bump the render ID so any in-flight async render (Safari worker or Chrome
    // await) that started at the old patternScale is treated as stale and its
    // commit is discarded.
    renderIdRef.current += 1;

    const canvas = canvasRef.current;
    if (!canvas || !showHighResOverlayRef.current) return;
    // No tile committed yet — nothing to transform.
    if (renderedPatternScaleRef.current === null) return;
    const ratio = patternScale / renderedPatternScaleRef.current;
    if (Math.abs(ratio - 1) < 0.0001) {
      canvas.style.transform = "";
      canvas.style.transformOrigin = "0 0";
      return;
    }
    const L = renderedCssLeftRef.current;
    const T = renderedCssTopRef.current;
    canvas.style.transformOrigin = "0 0";
    canvas.style.transform = `translate(${(L * (ratio - 1)).toFixed(1)}px, ${(T * (ratio - 1)).toFixed(1)}px) scale(${ratio.toFixed(4)})`;
  }, [patternScale]);

  // When entering or exiting magnify, hide the stale tile (it covers the wrong
  // region) and invalidate so the debounce fires an immediate re-render.
  useLayoutEffect(() => {
    const isMagnified = magnifyTransform !== null;
    if (wasMagnifiedRef.current === isMagnified) return;
    wasMagnifiedRef.current = isMagnified;
    renderIdRef.current += 1;
    // Hide the grid-space canvas.
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.style.display = "none";
    }
    // When leaving magnify, remove the body-level canvas and clear the cache.
    if (!isMagnified) {
      removeMagnifyCanvas();
      cachedTileRef.current = null;
    }
    renderedPatternScaleRef.current = null;
  }, [magnifyTransform, removeMagnifyCanvas]);

  // ===================================================================
  // compositeMagnifyTile — cheap re-draw of the cached tile onto the
  // body canvas with the current grid-to-screen transform. No pdf.js
  // render, no pixel worker — just a single drawImage + setTransform.
  // ===================================================================
  const compositeMagnifyTile = useCallback(() => {
    const tile = cachedTileRef.current;
    if (!tile) return;
    const mag = magnifyTransformRef.current;
    if (!mag) return;
    const bodyCanvas = magnifyCanvasRef.current;
    if (!bodyCanvas) return;
    if (!showHighResOverlayRef.current) return;

    const cal = inverse(perspectiveRef.current);
    const gridToScreen = cal.mmul(mag).mmul(localTransformRef.current);

    // Ensure body canvas is correctly sized (no-op if already set).
    if (
      bodyCanvas.width !== tile.screenCanvasW ||
      bodyCanvas.height !== tile.screenCanvasH
    ) {
      bodyCanvas.width = tile.screenCanvasW;
      bodyCanvas.height = tile.screenCanvasH;
      bodyCanvas.style.width = `${tile.screenWidth}px`;
      bodyCanvas.style.height = `${tile.screenHeight}px`;
    }

    const dest = bodyCanvas.getContext("2d");
    if (!dest) return;

    // Clear previous frame.
    dest.setTransform(1, 0, 0, 1, 0, 0);
    dest.clearRect(0, 0, tile.screenCanvasW, tile.screenCanvasH);

    // Affine approximation of the projective matrix.
    const m = gridToScreen;
    const w = m.get(2, 2);
    const a = m.get(0, 0) / w;
    const c = m.get(0, 1) / w;
    const e = m.get(0, 2) / w;
    const b = m.get(1, 0) / w;
    const d = m.get(1, 1) / w;
    const f = m.get(1, 2) / w;

    dest.setTransform(
      a * tile.dpr,
      b * tile.dpr,
      c * tile.dpr,
      d * tile.dpr,
      e * tile.dpr,
      f * tile.dpr,
    );

    if (tile.cssFilter) {
      dest.filter = tile.cssFilter;
    }
    dest.imageSmoothingEnabled = true;
    dest.imageSmoothingQuality = "high";
    dest.drawImage(
      tile.canvas,
      tile.cssLeft,
      tile.cssTop,
      tile.cssWidth,
      tile.cssHeight,
    );
    dest.setTransform(1, 0, 0, 1, 0, 0);
    dest.filter = "none";

    bodyCanvas.style.filter = tile.debugFilter;
    bodyCanvas.style.display = "";
  }, []);

  // Recomposite the cached magnify tile on every localTransform or
  // magnifyTransform change. useLayoutEffect so it paints before the
  // browser's next frame — keeps panning smooth.
  useLayoutEffect(() => {
    if (magnifyTransform === null) return;
    compositeMagnifyTile();
  }, [localTransform, magnifyTransform, compositeMagnifyTile]);

  // ===================================================================
  // renderHighRes
  // ===================================================================

  /**
   * Clears the in-flight flag and, if a render was requested while we were
   * busy, schedules a fresh call after a short delay. This ensures no
   * render request is silently dropped.
   */
  const finishRender = useCallback(() => {
    isRenderingRef.current = false;
    if (needsRenderRef.current) {
      needsRenderRef.current = false;
      // Short delay to coalesce any further rapid changes.
      setTimeout(() => {
        renderHighResRef.current?.();
      }, 50);
    }
  }, []);

  // We need renderHighRes to call finishRender, and finishRender to call
  // renderHighRes. Break the cycle with a ref that always points to the
  // latest renderHighRes.
  const renderHighResRef = useRef<(() => void) | null>(null);

  const renderHighRes = useCallback(async () => {
    if (!pdf) return;
    if (!showHighResOverlayRef.current) return;

    const isMagnified = magnifyTransform !== null;

    // Choose the target canvas based on magnify state.
    // When magnified, use a canvas appended to document.body so it's outside
    // the CSS transform chain. When not magnified, use the grid-space canvas.
    const canvas = isMagnified ? getOrCreateMagnifyCanvas() : canvasRef.current;
    if (!canvas) return;

    // If a render is already in-flight, mark that we need another one and
    // return. When the in-flight render completes, it will check this flag
    // and schedule a retry — so the request is never silently dropped.
    if (isRenderingRef.current) {
      needsRenderRef.current = true;
      return;
    }

    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;
    const rawDpr = window.devicePixelRatio;
    // Clamp Safari's DPR to 1 to prevent it from trying to render an enormous tile and improve rendering speed. In practice we'll be displayed on projectors where the DPR is effectively 1 anyway.
    const dpr = isSafari ? Math.min(rawDpr, 1) : rawDpr;

    // When magnified, account for the magnify transform when computing which
    // grid-container region is visible on screen.
    const magnifyScale = magnifyTransform
      ? Math.max(1, magnifyTransform.get(0, 0))
      : 1;
    const effectiveTransform = magnifyTransform
      ? magnifyTransform.mmul(localTransform)
      : localTransform;

    // Find which region of the PDF grid's CSS coordinate space is currently
    // visible on screen.
    const quad = getViewportQuad(
      perspective,
      effectiveTransform,
      screenWidth,
      screenHeight,
    );
    const [tl, br] = getBounds(quad);

    const quadW = br.x - tl.x;
    const quadH = br.y - tl.y;
    if (quadW <= 0 || quadH <= 0) return;

    // Padding factor for headroom. During magnify, Chrome can afford a larger
    // tile (pdf.js is fast); Safari needs a smaller tile to keep the pixel
    // worker time down.
    const paddingFactor =
      magnifyScale > 1
        ? isSafari
          ? 1.3
          : 1.8
        : isSafari
          ? SAFARI_PADDING_FACTOR
          : CHROME_PADDING_FACTOR;
    // Content key so the tile-skip check detects visual parameter changes
    // (erosions, recolour, theme, layers, etc.) — not just position/scale.
    const contentKey = `${renderVersion}-${erosions}-${recolourHex ?? ""}-${themeFilter ?? ""}-${debugTintHighRes ? 1 : 0}-${debugLowResBase ? 1 : 0}-${layersVersionRef.current}`;

    if (
      renderedPatternScaleRef.current !== null &&
      patternScale === renderedPatternScaleRef.current &&
      renderedContentKeyRef.current === contentKey
    ) {
      const tileLeft = renderedCssLeftRef.current;
      const tileTop = renderedCssTopRef.current;
      const tileW = renderedTileWidthRef.current;
      const tileH = renderedTileHeightRef.current;
      const marginX = tileW * MIN_TILE_MARGIN_FRACTION;
      const marginY = tileH * MIN_TILE_MARGIN_FRACTION;
      if (
        tl.x >= tileLeft + marginX &&
        br.x <= tileLeft + tileW - marginX &&
        tl.y >= tileTop + marginY &&
        br.y <= tileTop + tileH - marginY
      ) {
        return;
      }
    }

    // Expand region by the padding factor.
    // Past this point we're committed to a full render. Mark as in-flight
    // and bump the render ID so any previous in-flight worker is invalidated.
    isRenderingRef.current = true;
    const thisRenderId = ++renderIdRef.current;
    const padW = (quadW * (paddingFactor - 1)) / 2;
    const padH = (quadH * (paddingFactor - 1)) / 2;
    const regionX_css = tl.x - padW;
    const regionY_css = tl.y - padH;
    const regionW_css = quadW * paddingFactor;
    const regionH_css = quadH * paddingFactor;

    const page = (await pdf.getPage(pageNumber)) as PDFPageProxy;
    const userUnit = page.userUnit || 1;

    const pageView = page.getViewport({ scale: 1 });
    const pageW_css =
      pageView.width * PDF_TO_CSS_UNITS * userUnit * patternScale;
    const pageH_css =
      pageView.height * PDF_TO_CSS_UNITS * userUnit * patternScale;

    const pageOriginX = pageOffsetXBase * patternScale;
    const pageOriginY = pageOffsetYBase * patternScale;

    const rawLeft = Math.max(pageOriginX, regionX_css);
    const rawTop = Math.max(pageOriginY, regionY_css);
    const rawRight = Math.min(
      regionX_css + regionW_css,
      pageOriginX + pageW_css,
    );
    const rawBottom = Math.min(
      regionY_css + regionH_css,
      pageOriginY + pageH_css,
    );
    const cssLeft = Math.round(rawLeft);
    const cssTop = Math.round(rawTop);
    const cssRight = Math.round(rawRight);
    const cssBottom = Math.round(rawBottom);
    const cssWidth = cssRight - cssLeft;
    const cssHeight = cssBottom - cssTop;
    if (cssWidth <= 0 || cssHeight <= 0) {
      finishRender();
      return;
    }

    const cssToPage = 1 / (PDF_TO_CSS_UNITS * userUnit);
    const regionX_pdf = ((cssLeft - pageOriginX) / patternScale) * cssToPage;
    const regionY_pdf = ((cssTop - pageOriginY) / patternScale) * cssToPage;
    const regionW_pdf = (cssWidth / patternScale) * cssToPage;

    // -----------------------------------------------------------------
    // Pixel budget
    //
    // When magnified, the body-canvas covers the entire screen, but the
    // PDF tile only fills part of it. We size the PDF tile (tempCanvas)
    // to match the screen extent of the tile in device pixels, so the
    // rasterised content is 1:1 with screen pixels.
    // -----------------------------------------------------------------

    let tilePixelW: number;
    let tilePixelH: number;
    let screenCanvasW: number;
    let screenCanvasH: number;

    if (isMagnified) {
      // Compute grid-to-screen matrix: calibration × magnify × local.
      // perspective = inverse(calibrationTransform), so cal = inverse(perspective).
      const cal = inverse(perspective);
      const gridToScreen = cal.mmul(magnifyTransform!).mmul(localTransform);

      // Transform the tile's four corners to screen coordinates.
      const corners = [
        { x: cssLeft, y: cssTop },
        { x: cssRight, y: cssTop },
        { x: cssRight, y: cssBottom },
        { x: cssLeft, y: cssBottom },
      ];
      const screenCorners = corners.map((p) => {
        const v = gridToScreen.mmul(Matrix.columnVector([p.x, p.y, 1]));
        const w = v.get(2, 0);
        return { x: v.get(0, 0) / w, y: v.get(1, 0) / w };
      });
      const sxs = screenCorners.map((c) => c.x);
      const sys = screenCorners.map((c) => c.y);
      const screenTileW = Math.max(...sxs) - Math.min(...sxs);
      const screenTileH = Math.max(...sys) - Math.min(...sys);

      // pdf.js tile pixels = screen tile extent × DPR.
      tilePixelW = Math.round(screenTileW * dpr);
      tilePixelH = Math.round(screenTileH * dpr);

      // The body canvas covers the full screen.
      screenCanvasW = Math.round(screenWidth * dpr);
      screenCanvasH = Math.round(screenHeight * dpr);
    } else {
      tilePixelW = Math.round(cssWidth * dpr);
      tilePixelH = Math.round(cssHeight * dpr);
      screenCanvasW = tilePixelW;
      screenCanvasH = tilePixelH;
    }

    // Cap tile pixel budget per browser limits.
    const maxArea = isSafari ? 16_777_216 : 67_108_864;
    if (tilePixelW * tilePixelH > maxArea) {
      const factor = Math.sqrt(maxArea / (tilePixelW * tilePixelH));
      tilePixelW = Math.floor(tilePixelW * factor);
      tilePixelH = Math.floor(tilePixelH * factor);
    }
    if (tilePixelW <= 0 || tilePixelH <= 0) {
      finishRender();
      return;
    }

    const renderScale = tilePixelW / regionW_pdf;

    // Compare against the base render's scale. If the overlay wouldn't be
    // sharper than the base, hide it and bail.
    const baseRenderScale = getScale(
      pageView.width,
      pageView.height,
      userUnit,
      isSafari,
      debugLowResBase ?? false,
    );

    if (renderScale <= baseRenderScale) {
      canvas.style.display = "none";
      renderedPatternScaleRef.current = null;
      finishRender();
      return;
    }

    const normalBaseRenderScale = debugLowResBase
      ? getScale(pageView.width, pageView.height, userUnit, isSafari, false)
      : baseRenderScale;

    const viewport = page.getViewport({
      scale: renderScale,
      offsetX: -regionX_pdf * renderScale,
      offsetY: -regionY_pdf * renderScale,
    });

    // Cancel any in-flight render.
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
    }
    page.cleanup();

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = tilePixelW;
    tempCanvas.height = tilePixelH;
    const ctx = tempCanvas.getContext("2d", {
      alpha: false,
      willReadFrequently: isSafari,
    });
    if (!ctx) {
      finishRender();
      return;
    }

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
      finishRender();
      return;
    }

    // Post-processing (erosion, recolouring, theme filter).
    const scaleRatio = renderScale / normalBaseRenderScale;
    const effectiveErosionsChrome = Math.round(erosions * scaleRatio);
    const effectiveErosionsSafari = erosions;
    const useRecolour = !!recolourHex && !isSafari;
    const renderErosions = isSafari ? effectiveErosionsSafari : 0;
    const safariEffectiveRecolourHex = isSafari
      ? recolourHex ?? (themeFilter === "invert(1)" ? "#ffffff" : undefined)
      : undefined;
    const cssFilter = isSafari
      ? undefined
      : [
          erosionFilter(effectiveErosionsChrome, useRecolour),
          themeFilter && themeFilter !== "none" ? themeFilter : undefined,
        ]
          .filter(Boolean)
          .join(" ");

    const debugFilter = debugTintHighRes
      ? "invert(1) brightness(1.0) sepia(1) saturate(10) hue-rotate(15deg)"
      : "";

    // =================================================================
    // COMMIT: write pixels to the visible canvas.
    // =================================================================

    if (isMagnified) {
      // ------ MAGNIFY PATH: body-level screen-space canvas ------
      // Cache the rendered tile and its metadata. The heavy work (pdf.js render)
      // is done; from here on, panning just calls compositeMagnifyTile() which
      // does a cheap drawImage + setTransform.
      const commitMagnify = (sourceCanvas: HTMLCanvasElement) => {
        if (thisRenderId !== renderIdRef.current) return;
        if (patternScale !== currentPatternScaleRef.current) return;

        cachedTileRef.current = {
          canvas: sourceCanvas,
          cssLeft,
          cssTop,
          cssWidth,
          cssHeight,
          cssFilter: !isSafari && cssFilter ? cssFilter : undefined,
          debugFilter,
          screenCanvasW,
          screenCanvasH,
          screenWidth,
          screenHeight,
          dpr,
        };

        renderedPatternScaleRef.current = patternScale;
        renderedContentKeyRef.current = contentKey;
        renderedCssLeftRef.current = cssLeft;
        renderedCssTopRef.current = cssTop;
        renderedTileWidthRef.current = cssWidth;
        renderedTileHeightRef.current = cssHeight;

        // Draw the tile immediately via the compositing function.
        compositeMagnifyTile();
      };

      if (isSafari) {
        const rawImageData = ctx.getImageData(0, 0, tilePixelW, tilePixelH);
        const request: PixelProcessRequest = {
          id: thisRenderId,
          buffer: rawImageData.data.buffer,
          width: tilePixelW,
          height: tilePixelH,
          erosions: renderErosions,
          recolourHex: safariEffectiveRecolourHex ?? undefined,
        };
        const worker = getWorker();
        worker.onmessage = (e: MessageEvent<PixelProcessResponse>) => {
          finishRender();
          const { id, bitmap } = e.data;
          if (id !== renderIdRef.current) {
            bitmap.close();
            return;
          }
          if (patternScale !== currentPatternScaleRef.current) {
            bitmap.close();
            return;
          }
          // Draw bitmap into a temp canvas so commitMagnify can use drawImage.
          const tmp = document.createElement("canvas");
          tmp.width = tilePixelW;
          tmp.height = tilePixelH;
          const tmpCtx = tmp.getContext("2d", { alpha: false });
          if (tmpCtx) tmpCtx.drawImage(bitmap, 0, 0);
          bitmap.close();
          commitMagnify(tmp);
        };
        worker.postMessage(request, [request.buffer]);
      } else {
        finishRender();
        commitMagnify(tempCanvas);
      }
    } else {
      // ------ NORMAL PATH: grid-space canvas (unchanged) ------
      if (isSafari) {
        const rawImageData = ctx.getImageData(0, 0, tilePixelW, tilePixelH);
        const request: PixelProcessRequest = {
          id: thisRenderId,
          buffer: rawImageData.data.buffer,
          width: tilePixelW,
          height: tilePixelH,
          erosions: renderErosions,
          recolourHex: safariEffectiveRecolourHex ?? undefined,
        };
        const worker = getWorker();
        worker.onmessage = (e: MessageEvent<PixelProcessResponse>) => {
          finishRender();
          const { id, bitmap } = e.data;
          if (id !== renderIdRef.current) {
            bitmap.close();
            return;
          }
          if (patternScale !== currentPatternScaleRef.current) {
            bitmap.close();
            return;
          }
          canvas.width = tilePixelW;
          canvas.height = tilePixelH;
          canvas.style.width = `${cssWidth}px`;
          canvas.style.height = `${cssHeight}px`;
          canvas.style.left = `${cssLeft}px`;
          canvas.style.top = `${cssTop}px`;
          canvas.style.filter = debugFilter;
          canvas.style.transform = "";
          canvas.style.transformOrigin = "0 0";
          renderedPatternScaleRef.current = patternScale;
          renderedContentKeyRef.current = contentKey;
          renderedCssLeftRef.current = cssLeft;
          renderedCssTopRef.current = cssTop;
          renderedTileWidthRef.current = cssWidth;
          renderedTileHeightRef.current = cssHeight;
          const dest = canvas.getContext("2d", { alpha: false });
          if (dest) {
            dest.drawImage(bitmap, 0, 0);
          }
          bitmap.close();
          canvas.style.display = showHighResOverlayRef.current ? "" : "none";
        };
        worker.postMessage(request, [request.buffer]);
      } else {
        finishRender();
        if (thisRenderId !== renderIdRef.current) return;
        if (patternScale !== currentPatternScaleRef.current) return;
        canvas.width = tilePixelW;
        canvas.height = tilePixelH;
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
        canvas.style.transform = "";
        canvas.style.transformOrigin = "0 0";
        renderedPatternScaleRef.current = patternScale;
        renderedContentKeyRef.current = contentKey;
        renderedCssLeftRef.current = cssLeft;
        renderedCssTopRef.current = cssTop;
        renderedTileWidthRef.current = cssWidth;
        renderedTileHeightRef.current = cssHeight;
        canvas.style.display = showHighResOverlayRef.current ? "" : "none";
      }
    }
  }, [
    pdf,
    perspective,
    localTransform,
    magnifyTransform,
    pageNumber,
    patternScale,
    erosions,
    layers,
    recolourHex,
    renderVersion,
    debugTintHighRes,
    debugLowResBase,
    themeFilter,
    isSafari,
    getWorker,
    getOrCreateMagnifyCanvas,
    compositeMagnifyTile,
    pageOffsetXBase,
    pageOffsetYBase,
    finishRender,
  ]);

  // Keep the ref in sync so finishRender can call the latest renderHighRes.
  renderHighResRef.current = renderHighRes;

  // Debounce render triggers.
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    // Use a shorter delay when no tile exists yet (first load / magnify
    // transition) so the overlay appears quickly. Still debounced rather
    // than immediate so rapid dep changes don't fire many concurrent renders.
    const delay = renderedPatternScaleRef.current === null ? 50 : DEBOUNCE_MS;
    debounceTimerRef.current = setTimeout(() => {
      renderHighRes();
    }, delay);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [renderHighRes]);

  // The grid-space canvas (normal mode). Hidden when magnified.
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
