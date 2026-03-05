// pdf-high-res-viewport.tsx
// High-resolution overlay for the visible viewport area. Debounces after pan/zoom,
// renders the visible PDF sub-region at full device resolution, and composites it
// on top of the base render so the projected area stays sharp when zoomed in.
//
// Normal mode: canvas positioned inside the grid container (grid-space CSS).
// Magnify mode: a SEPARATE canvas inserted into the MeasureCanvas container
// (outside the CSS transform chain) positioned via CSS matrix3d() so the
// compositor preserves the full backing-store resolution through magnification.

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
import { Matrix } from "ml-matrix";
import { getBounds, getViewportQuad, toMatrix3d } from "@/_lib/geometry";
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

interface Props {
  /** Perspective matrix: maps screen space → pattern space. */
  perspective: Matrix;
  /** Calibration transform: maps grid space → screen space (inverse of perspective). */
  calibrationTransform?: Matrix;
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
  calibrationTransform,
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
  // Magnify canvas (created imperatively, inserted into MeasureCanvas container).
  const magnifyCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const renderTaskRef = useRef<ReturnType<PDFPageProxy["render"]> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  // Grid-space tile bounds and canvas CSS dimensions cached so that
  // panning only requires a CSS transform update — no canvas 2D ops.
  const cachedTileRef = useRef<{
    cssLeft: number;
    cssTop: number;
    cssWidth: number;
    cssHeight: number;
    canvasCssW: number;
    canvasCssH: number;
  } | null>(null);

  // Always-current refs for values the compositing effect needs without
  // being in its dependency array.
  const localTransformRef = useRef(localTransform);
  localTransformRef.current = localTransform;
  const magnifyTransformRef = useRef(magnifyTransform);
  magnifyTransformRef.current = magnifyTransform;
  const calibrationTransformRef = useRef(calibrationTransform);
  calibrationTransformRef.current = calibrationTransform;

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
   * Returns (or creates) the magnify canvas. Inserted into the
   * MeasureCanvas container (found via data-magnify-container) so it
   * shares the same stacking context as OverlayCanvas — z-index 10
   * puts it above the Draggable (z-0) but below the overlay (z-20).
   */
  const getOrCreateMagnifyCanvas = useCallback((): HTMLCanvasElement => {
    if (!magnifyCanvasRef.current) {
      const c = document.createElement("canvas");
      c.style.position = "absolute";
      c.style.left = "0";
      c.style.top = "0";
      c.style.pointerEvents = "none";
      c.style.imageRendering = "auto";
      c.style.transformOrigin = "0 0";
      c.style.zIndex = "10";
      // Find the MeasureCanvas container and insert the canvas there.
      const container =
        canvasRef.current?.closest("[data-magnify-container]") ?? document.body;
      container.appendChild(c);
      magnifyCanvasRef.current = c;
    }
    return magnifyCanvasRef.current;
  }, []);

  /** Hides and detaches the magnify canvas if it exists. */
  const removeMagnifyCanvas = useCallback(() => {
    if (magnifyCanvasRef.current) {
      magnifyCanvasRef.current.remove();
      magnifyCanvasRef.current = null;
    }
  }, []);

  // Terminate the pixel worker and remove magnify canvas when unmounting.
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
    // When leaving magnify, remove the magnify canvas and clear the cache.
    if (!isMagnified) {
      removeMagnifyCanvas();
      cachedTileRef.current = null;
    }
    renderedPatternScaleRef.current = null;
  }, [magnifyTransform, removeMagnifyCanvas]);

  // ===================================================================
  // compositeMagnifyTile — update the CSS matrix3d on the magnify canvas.
  // Uses calibrationTransform directly (same as Draggable) to avoid the
  // double-inverse error from inverse(perspective).
  // ===================================================================
  const compositeMagnifyTile = useCallback(() => {
    const tile = cachedTileRef.current;
    if (!tile) return;
    const mag = magnifyTransformRef.current;
    if (!mag) return;
    const cal = calibrationTransformRef.current;
    const bodyCanvas = magnifyCanvasRef.current;
    if (!bodyCanvas) return;
    if (!showHighResOverlayRef.current) return;

    // gridToScreen: same chain as Draggable's CSS transform.
    const gridToScreen = cal
      ? cal.mmul(mag).mmul(localTransformRef.current)
      : mag.mmul(localTransformRef.current);

    // Canvas-CSS → grid-space transform.
    // Canvas CSS (0,0)→(canvasCssW,canvasCssH) maps to
    // grid (cssLeft,cssTop)→(cssLeft+cssWidth,cssTop+cssHeight).
    const sx = tile.cssWidth / tile.canvasCssW;
    const sy = tile.cssHeight / tile.canvasCssH;
    const T = Matrix.from1DArray(3, 3, [
      sx,
      0,
      tile.cssLeft,
      0,
      sy,
      tile.cssTop,
      0,
      0,
      1,
    ]);

    // Full projective: canvas CSS → grid → screen.
    const canvasToScreen = gridToScreen.mmul(T);

    bodyCanvas.style.transform = toMatrix3d(canvasToScreen);
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

    // The grid-space canvas is always needed for position tracking and
    // non-magnified commits. When magnified, the actual pixels go to
    // a separate body canvas positioned via CSS matrix3d.
    const canvas = canvasRef.current;
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
    // Clamp Safari's DPR to 1 to prevent it from trying to render an enormous tile and improve rendering speed. In practice we'll be displayed on projectors where the DPR is effectively 1 anyway. Chrome renders quickly so we can use the full DPR for a sharper image.
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
    // When magnified, the canvas CSS box is in grid space but the
    // backing store is sized for the screen extent of the tile (in
    // device pixels) so the GPU compositor has enough resolution to
    // display it 1:1 after the CSS transform magnifies it.
    // -----------------------------------------------------------------

    let tilePixelW: number;
    let tilePixelH: number;

    if (isMagnified) {
      // Compute grid-to-screen matrix: calibration × magnify × local.
      // Use calibrationTransformRef directly (not inverse(perspective)) to
      // avoid double-inverse numerical error with extreme distortion.
      const cal = calibrationTransformRef.current ?? Matrix.eye(3);
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
      const screenTileW = Math.max(...sxs) - Math.min(...sxs);

      // pdf.js tile pixels = screen tile extent × DPR for the width.
      // Force the height to maintain the grid-space aspect ratio because
      // pdf.js renders with an isotropic scale (renderScale = tilePixelW /
      // regionW_pdf). Without this, projective distortion makes screenTileH /
      // screenTileW differ from cssHeight / cssWidth — the T matrix in
      // compositeMagnifyTile then uses the wrong Y scale, causing a
      // position error that grows with the amount of distortion.
      tilePixelW = Math.round(screenTileW * dpr);
      tilePixelH = Math.round((tilePixelW * cssHeight) / cssWidth);
    } else {
      tilePixelW = Math.round(cssWidth * dpr);
      tilePixelH = Math.round(cssHeight * dpr);
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
      if (isMagnified) {
        removeMagnifyCanvas();
        cachedTileRef.current = null;
      }
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
    // COMMIT: write rendered pixels to the target canvas.
    //
    // Non-magnified: grid-space canvas inside the CSS transform chain.
    // Magnified: body canvas (outside the CSS chain) positioned via a
    // CSS matrix3d that matches Draggable's transform exactly. This
    // preserves the full backing-store resolution — the compositor
    // doesn't downsample it through the magnify upscale.
    // =================================================================

    // CSS box dimensions. For magnified the box matches the backing
    // store / DPR so the compositor texture is 1:1 with the rendered
    // pixels. For non-magnified the box is the grid-space tile extent.
    const canvasCssW = isMagnified ? tilePixelW / dpr : cssWidth;
    const canvasCssH = isMagnified ? tilePixelH / dpr : cssHeight;

    /** Helper: update shared refs after a successful commit. */
    const commitRefs = () => {
      renderedPatternScaleRef.current = patternScale;
      renderedContentKeyRef.current = contentKey;
      renderedCssLeftRef.current = cssLeft;
      renderedCssTopRef.current = cssTop;
      renderedTileWidthRef.current = cssWidth;
      renderedTileHeightRef.current = cssHeight;
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
        if (isMagnified) {
          // --- Magnified: write to the body canvas ---
          const bodyCanvas = getOrCreateMagnifyCanvas();
          bodyCanvas.width = tilePixelW;
          bodyCanvas.height = tilePixelH;
          bodyCanvas.style.width = `${canvasCssW}px`;
          bodyCanvas.style.height = `${canvasCssH}px`;
          bodyCanvas.style.filter = debugFilter;
          const dest = bodyCanvas.getContext("2d", { alpha: false });
          if (dest) {
            dest.drawImage(bitmap, 0, 0);
          }
          bitmap.close();
          cachedTileRef.current = {
            cssLeft,
            cssTop,
            cssWidth,
            cssHeight,
            canvasCssW,
            canvasCssH,
          };
          compositeMagnifyTile();
          canvas.style.display = "none";
        } else {
          // --- Non-magnified: write to the grid-space canvas ---
          canvas.width = tilePixelW;
          canvas.height = tilePixelH;
          canvas.style.width = `${canvasCssW}px`;
          canvas.style.height = `${canvasCssH}px`;
          canvas.style.left = `${cssLeft}px`;
          canvas.style.top = `${cssTop}px`;
          canvas.style.filter = debugFilter;
          canvas.style.transformOrigin = "0 0";
          canvas.style.transform = "";
          const dest = canvas.getContext("2d", { alpha: false });
          if (dest) {
            dest.drawImage(bitmap, 0, 0);
          }
          bitmap.close();
          canvas.style.display = showHighResOverlayRef.current ? "" : "none";
        }
        commitRefs();
      };
      worker.postMessage(request, [request.buffer]);
    } else {
      finishRender();
      if (thisRenderId !== renderIdRef.current) return;
      if (patternScale !== currentPatternScaleRef.current) return;

      if (isMagnified) {
        // --- Magnified: write to the body canvas ---
        const bodyCanvas = getOrCreateMagnifyCanvas();
        bodyCanvas.width = tilePixelW;
        bodyCanvas.height = tilePixelH;
        bodyCanvas.style.width = `${canvasCssW}px`;
        bodyCanvas.style.height = `${canvasCssH}px`;
        const dest = bodyCanvas.getContext("2d");
        if (!dest) return;
        dest.imageSmoothingEnabled = false;
        dest.filter = cssFilter ?? "none";
        dest.drawImage(tempCanvas, 0, 0);
        bodyCanvas.style.filter = debugFilter;
        cachedTileRef.current = {
          cssLeft,
          cssTop,
          cssWidth,
          cssHeight,
          canvasCssW,
          canvasCssH,
        };
        compositeMagnifyTile();
        canvas.style.display = "none";
      } else {
        // --- Non-magnified: write to the grid-space canvas ---
        canvas.width = tilePixelW;
        canvas.height = tilePixelH;
        canvas.style.width = `${canvasCssW}px`;
        canvas.style.height = `${canvasCssH}px`;
        canvas.style.left = `${cssLeft}px`;
        canvas.style.top = `${cssTop}px`;
        const dest = canvas.getContext("2d");
        if (!dest) return;
        dest.imageSmoothingEnabled = false;
        dest.filter = cssFilter ?? "none";
        dest.drawImage(tempCanvas, 0, 0);
        canvas.style.filter = debugFilter;
        canvas.style.transformOrigin = "0 0";
        canvas.style.transform = "";
        canvas.style.display = showHighResOverlayRef.current ? "" : "none";
      }
      commitRefs();
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
    removeMagnifyCanvas,
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
