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

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react"
import { useDocumentContext } from "react-pdf"
import invariant from "tiny-invariant"
import type { PDFPageProxy } from "pdfjs-dist"
import { Matrix } from "ml-matrix"
import { inverse } from "ml-matrix"
import { transformPoint } from "@/_lib/geometry"
import { PDF_TO_CSS_UNITS } from "@/_lib/pixels-per-inch"
import { erosionFilter } from "@/_lib/erode"
import useRenderContext from "@/_hooks/use-render-context"
import { getScale } from "@/_components/pdf-custom-renderer"
import { useTransformContext } from "@/_hooks/use-transform-context"
import type { Point } from "@/_lib/point"
import type {
  PixelProcessRequest,
  PixelProcessResponse,
} from "@/_lib/pixel-processor.worker"

/** Displayed diameter of the loupe canvas in CSS px. */
const LOUPE_DISPLAY_PX = 240

/**
 * How many times to magnify the PDF region. A value of 4 means the loupe
 * shows a region that is LOUPE_DISPLAY_PX / LOUPE_ZOOM = 60 CSS px wide.
 */
const LOUPE_ZOOM = 4

/**
 * Gap in CSS px between the endpoint centre and the nearest edge of the
 * loupe circle. The loupe appears to the top-right of the endpoint.
 * The endpoint hover indicator has radius ~30px + ~16px whiskers, so
 * a gap of 40px keeps the loupe clearly clear of it.
 */
const LOUPE_GAP = 40

/**
 * If the pointer has moved fewer than this many screen pixels since the
 * last render, skip issuing a new pdf.js render (stale content is close
 * enough).
 */
const RENDER_SKIP_PX = 4

/** Custom event name fired by MeasureCanvas. */
export const LOUPE_POINT_EVENT = "loupe-point"

interface Props {
  /** Perspective matrix: maps screen space → pattern space. */
  perspective: Matrix
  /** Calibration transform: maps pattern space → screen space. */
  calibrationTransform?: Matrix
  /** PDF page number to render (1-based). */
  pageNumber: number
  /** Horizontal offset of this page's top-left in the grid container at patternScale=1. */
  pageOffsetXBase?: number
  /** Vertical offset of this page's top-left in the grid container at patternScale=1. */
  pageOffsetYBase?: number
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
}: Props)
{
  const docContext = useDocumentContext()
  invariant(
    docContext,
    "PdfLoupe must be rendered inside a react-pdf Document context",
  )
  const { pdf } = docContext

  const localTransform = useTransformContext()

  const {
    erosions,
    layers,
    patternScale,
    recolourHex,
    renderVersion,
    themeFilter,
  } = useRenderContext()

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const renderTaskRef = useRef<ReturnType<PDFPageProxy["render"]> | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const renderIdRef = useRef(0)

  /** True while a pdf.js render or Safari worker is in-flight. */
  const isRenderingRef = useRef(false)
  /** Set to the latest requested point when a render arrives while one is
   *  already in-flight. The in-flight render checks this on completion and
   *  schedules a follow-up so no request is silently dropped. */
  const needsRenderRef = useRef<Point | null>(null)
  /** Screen-space point of the most recently committed render, used to
   *  decide whether to skip issuing a new pdf.js render. */
  const lastRenderScreenPtRef = useRef<Point | null>(null)
  /** Velocity tracking for adaptive debounce. */
  const lastEventPointRef = useRef<Point | null>(null)
  const lastEventTimeRef = useRef<number>(0)

  // Stable refs so renderLoupe (the async function) always reads the latest values
  // without needing to be recreated on every prop/state change.
  const perspectiveRef = useRef(perspective)
  perspectiveRef.current = perspective
  const localTransformRef = useRef(localTransform)
  localTransformRef.current = localTransform
  const erosionsRef = useRef(erosions)
  erosionsRef.current = erosions
  const layersRef = useRef(layers)
  layersRef.current = layers
  const patternScaleRef = useRef(patternScale)
  patternScaleRef.current = patternScale
  const recolourHexRef = useRef(recolourHex)
  recolourHexRef.current = recolourHex
  const renderVersionRef = useRef(renderVersion)
  renderVersionRef.current = renderVersion
  const themeFilterRef = useRef(themeFilter)
  themeFilterRef.current = themeFilter
  const pageOffsetXBaseRef = useRef(pageOffsetXBase)
  pageOffsetXBaseRef.current = pageOffsetXBase
  const pageOffsetYBaseRef = useRef(pageOffsetYBase)
  pageOffsetYBaseRef.current = pageOffsetYBase
  const pdfRef = useRef(pdf)
  pdfRef.current = pdf

  const isSafari = useMemo(() =>
  {
    const ua = navigator.userAgent.toLowerCase()
    return ua.indexOf("safari") !== -1 && ua.indexOf("chrome") === -1
  }, [])

  const isSafariRef = useRef(isSafari)
  isSafariRef.current = isSafari

  const getWorker = useCallback((): Worker =>
  {
    if (!workerRef.current)
    {
      workerRef.current = new Worker(
        new URL("../_lib/pixel-processor.worker", import.meta.url),
      )
    }
    return workerRef.current
  }, [])

  const getOrCreateCanvas = useCallback((): HTMLCanvasElement =>
  {
    if (canvasRef.current) return canvasRef.current

    const canvas = document.createElement("canvas")
    canvas.style.position = "fixed"
    canvas.style.width = `${LOUPE_DISPLAY_PX}px`
    canvas.style.height = `${LOUPE_DISPLAY_PX}px`
    canvas.style.borderRadius = "50%"
    canvas.style.border = "2px solid rgba(255,255,255,0.65)"
    canvas.style.boxShadow = "0 2px 16px rgba(0,0,0,0.5)"
    canvas.style.pointerEvents = "none"
    canvas.style.zIndex = "60"
    canvas.style.display = "none"
    canvas.style.imageRendering = "pixelated"
    document.body.appendChild(canvas)
    canvasRef.current = canvas
    return canvas
  }, [])

  const removeCanvas = useCallback(() =>
  {
    canvasRef.current?.remove()
    canvasRef.current = null
  }, [])

  // Clean up on unmount.
  useEffect(() =>
  {
    return () =>
    {
      workerRef.current?.terminate()
      workerRef.current = null
      removeCanvas()
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    }
  }, [removeCanvas])

  // ---------------------------------------------------------------
  // renderLoupe — renders a magnified inset of the PDF centred on
  // the provided screen point. Designed to be called from a stable
  // ref so it always operates on the latest prop/state values.
  // ---------------------------------------------------------------

  /** Positions the loupe canvas at the top-right of the given screen point.
   *  Called immediately on every loupe-point event so the canvas follows the
   *  cursor without waiting for the async pdf.js render to complete. */
  const snapCanvasPosition = useCallback((screenPoint: Point) =>
  {
    const canvas = getOrCreateCanvas()
    canvas.style.left = `${Math.round(screenPoint.x + LOUPE_GAP)}px`
    canvas.style.top = `${Math.round(screenPoint.y - LOUPE_DISPLAY_PX - LOUPE_GAP)}px`
  }, [getOrCreateCanvas])

  const snapCanvasPositionRef = useRef(snapCanvasPosition)
  snapCanvasPositionRef.current = snapCanvasPosition

  /**
   * Called when a render finishes (successfully or via Safari worker). Clears
   * the in-flight flag and, if another point arrived while we were busy,
   * schedules a fresh render so no request is silently dropped.
   */
  const finishRender = useCallback((renderedScreenPt: Point | null) =>
  {
    isRenderingRef.current = false
    if (renderedScreenPt) lastRenderScreenPtRef.current = renderedScreenPt
    const pending = needsRenderRef.current
    if (pending)
    {
      needsRenderRef.current = null
      setTimeout(() => renderLoupeRef.current?.(pending), 0)
    }
  }, [])

  const finishRenderRef = useRef(finishRender)
  finishRenderRef.current = finishRender

  const renderLoupe = useCallback(async (screenPoint: Point) =>
  {
    const currentPdf = pdfRef.current
    if (!currentPdf) return

    if (isRenderingRef.current)
    {
      needsRenderRef.current = screenPoint
      return
    }

    const currentDpr = isSafariRef.current
      ? Math.min(window.devicePixelRatio, 1)
      : window.devicePixelRatio
    const pixelSize = Math.round(LOUPE_DISPLAY_PX * currentDpr)

    const currentPerspective = perspectiveRef.current
    const currentLocalTransform = localTransformRef.current
    const currentPatternScale = patternScaleRef.current
    const currentErosions = erosionsRef.current
    const currentLayers = layersRef.current
    const currentRecolourHex = recolourHexRef.current
    const currentThemeFilter = themeFilterRef.current
    const currentPageOffsetXBase = pageOffsetXBaseRef.current
    const currentPageOffsetYBase = pageOffsetYBaseRef.current

    // Map the screen point to grid-container CSS coordinates.
    // This mirrors the single-point version of getViewportQuad:
    //   screen → pattern space (via perspective) → grid CSS (undo localTransform).
    const calibratedPoint = transformPoint(screenPoint, currentPerspective)
    const gridCssPt = transformPoint(calibratedPoint, inverse(currentLocalTransform))

    // Radius of the viewed region in grid-CSS px at the requested zoom factor.
    const radiusCss = (LOUPE_DISPLAY_PX / 2) / LOUPE_ZOOM

    const pageOriginX = currentPageOffsetXBase * currentPatternScale
    const pageOriginY = currentPageOffsetYBase * currentPatternScale

    const page = await currentPdf.getPage(pageNumber) as PDFPageProxy
    const userUnit = page.userUnit || 1
    const pageView = page.getViewport({ scale: 1 })
    const pageWidthCss = pageView.width * PDF_TO_CSS_UNITS * userUnit * currentPatternScale
    const pageHeightCss = pageView.height * PDF_TO_CSS_UNITS * userUnit * currentPatternScale

    // Clamp the region to page bounds.
    const rawLeft = Math.max(pageOriginX, gridCssPt.x - radiusCss)
    const rawRight = Math.min(pageOriginX + pageWidthCss, gridCssPt.x + radiusCss)
    const rawTop = Math.max(pageOriginY, gridCssPt.y - radiusCss)
    const rawBottom = Math.min(pageOriginY + pageHeightCss, gridCssPt.y + radiusCss)

    const canvas = getOrCreateCanvas()

    if (rawRight <= rawLeft || rawBottom <= rawTop)
    {
      // The screen point is outside this page's bounds.
      // Hide only if no other page has claimed display (each instance manages its own canvas).
      canvas.style.display = "none"
      finishRenderRef.current(null)
      return
    }

    const cssWidth = rawRight - rawLeft

    const cssToPage = 1 / (PDF_TO_CSS_UNITS * userUnit)
    const regionXPdf = ((rawLeft - pageOriginX) / currentPatternScale) * cssToPage
    const regionYPdf = ((rawTop - pageOriginY) / currentPatternScale) * cssToPage
    const regionWPdf = (cssWidth / currentPatternScale) * cssToPage

    const renderScale = pixelSize / regionWPdf

    // Bail if the loupe wouldn't be sharper than the base render.
    const baseScale = getScale(
      pageView.width,
      pageView.height,
      userUnit,
      isSafariRef.current,
      false,
    )
    if (renderScale <= baseScale)
    {
      canvas.style.display = "none"
      finishRenderRef.current(null)
      return
    }

    isRenderingRef.current = true
    const thisRenderId = ++renderIdRef.current

    const viewport = page.getViewport({
      scale: renderScale,
      offsetX: -regionXPdf * renderScale,
      offsetY: -regionYPdf * renderScale,
    })

    if (renderTaskRef.current)
    {
      renderTaskRef.current.cancel()
    }
    page.cleanup()

    const tempCanvas = document.createElement("canvas")
    tempCanvas.width = pixelSize
    tempCanvas.height = pixelSize
    const ctx = tempCanvas.getContext("2d", {
      alpha: false,
      willReadFrequently: isSafariRef.current,
    })
    if (!ctx)
    {
      finishRenderRef.current(null)
      return
    }

    const optionalContentConfig = await currentPdf.getOptionalContentConfig()
    for (const layer of Object.values(currentLayers))
    {
      for (const id of layer.ids)
      {
        optionalContentConfig.setVisibility(id, layer.visible)
      }
    }

    const renderTask = page.render({
      canvasContext: ctx as any,
      viewport,
      optionalContentConfigPromise: Promise.resolve(optionalContentConfig),
    })
    renderTaskRef.current = renderTask

    try
    {
      await renderTask.promise
    }
    catch (_e)
    {
      finishRenderRef.current(null)
      return
    }

    if (thisRenderId !== renderIdRef.current)
    {
      finishRenderRef.current(null)
      return
    }

    // Post-processing parameters.
    const scaleRatio = renderScale / baseScale
    const effectiveErosionsChrome = Math.round(currentErosions * scaleRatio)
    const useRecolour = !!currentRecolourHex && !isSafariRef.current
    const cssFilter = isSafariRef.current
      ? undefined
      : [
          erosionFilter(effectiveErosionsChrome, useRecolour),
          currentThemeFilter && currentThemeFilter !== "none"
            ? currentThemeFilter
            : undefined,
        ]
          .filter(Boolean)
          .join(" ")
    const safariRecolourHex = isSafariRef.current
      ? currentRecolourHex ?? (currentThemeFilter === "invert(1)" ? "#ffffff" : undefined)
      : undefined

    /**
     * Commits the rendered image to the visible canvas and draws the crosshair.
     * Accepts either a canvas or an ImageBitmap produced by the Safari pixel worker.
     */
    const commit = (source: CanvasImageSource) =>
    {
      if (thisRenderId !== renderIdRef.current) return

      canvas.width = pixelSize
      canvas.height = pixelSize

      const dest = canvas.getContext("2d", { alpha: false })
      if (!dest) return

      if (!isSafariRef.current)
      {
        dest.imageSmoothingEnabled = false
        dest.filter = cssFilter ?? "none"
      }

      dest.drawImage(source, 0, 0)

      // Draw gapped crosshair over the committed PDF content.
      dest.save()
      dest.filter = "none"
      dest.imageSmoothingEnabled = false

      const centreX = pixelSize / 2
      const centreY = pixelSize / 2
      const armLength = Math.round(14 * currentDpr)
      const armGap = Math.round(3 * currentDpr)

      // Dark shadow pass for visibility on light content.
      dest.strokeStyle = "rgba(0, 0, 0, 0.5)"
      dest.lineWidth = 2.5 * currentDpr
      dest.beginPath()
      dest.moveTo(centreX - armLength, centreY)
      dest.lineTo(centreX - armGap, centreY)
      dest.moveTo(centreX + armGap, centreY)
      dest.lineTo(centreX + armLength, centreY)
      dest.moveTo(centreX, centreY - armLength)
      dest.lineTo(centreX, centreY - armGap)
      dest.moveTo(centreX, centreY + armGap)
      dest.lineTo(centreX, centreY + armLength)
      dest.stroke()

      // Bright coloured pass.
      dest.strokeStyle = "rgba(255, 50, 50, 0.9)"
      dest.lineWidth = 1.5 * currentDpr
      dest.beginPath()
      dest.moveTo(centreX - armLength, centreY)
      dest.lineTo(centreX - armGap, centreY)
      dest.moveTo(centreX + armGap, centreY)
      dest.lineTo(centreX + armLength, centreY)
      dest.moveTo(centreX, centreY - armLength)
      dest.lineTo(centreX, centreY - armGap)
      dest.moveTo(centreX, centreY + armGap)
      dest.lineTo(centreX, centreY + armLength)
      dest.stroke()

      dest.restore()

      // Position is already snapped to the current pointer position by
      // snapCanvasPosition — just make the canvas visible.
      canvas.style.display = ""
    }

    if (isSafariRef.current)
    {
      const rawImageData = ctx.getImageData(0, 0, pixelSize, pixelSize)
      const request: PixelProcessRequest = {
        id: thisRenderId,
        buffer: rawImageData.data.buffer,
        width: pixelSize,
        height: pixelSize,
        erosions: currentErosions,
        recolourHex: safariRecolourHex ?? undefined,
      }
      const worker = getWorker()
      worker.onmessage = (event: MessageEvent<PixelProcessResponse>) =>
      {
        const { id, bitmap } = event.data
        if (id !== renderIdRef.current)
        {
          bitmap.close()
          finishRenderRef.current(null)
          return
        }
        commit(bitmap)
        bitmap.close()
        finishRenderRef.current(screenPoint)
      }
      worker.postMessage(request, [request.buffer])
    }
    else
    {
      commit(tempCanvas)
      finishRenderRef.current(screenPoint)
    }
  }, [pageNumber, getOrCreateCanvas, getWorker])

  // Stable ref so the event handler (registered once on mount) always calls the
  // latest renderLoupe without needing to re-register.
  const renderLoupeRef = useRef(renderLoupe)
  renderLoupeRef.current = renderLoupe

  // Listen for loupe-point events dispatched by MeasureCanvas.
  useEffect(() =>
  {
    const handleLoupePoint = (event: Event) =>
    {
      const screenPoint = (event as CustomEvent<Point | null>).detail

      if (debounceTimerRef.current)
      {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }

      if (!screenPoint)
      {
        // Endpoint released or pointer left — hide this instance's canvas.
        renderIdRef.current++
        isRenderingRef.current = false
        needsRenderRef.current = null
        lastRenderScreenPtRef.current = null
        lastEventPointRef.current = null
        const canvas = canvasRef.current
        if (canvas) canvas.style.display = "none"
        return
      }

      // 1. Snap canvas position immediately so the loupe follows the cursor
      //    without waiting for the async render to complete.
      snapCanvasPositionRef.current(screenPoint)

      // 2. Skip a new pdf.js render if the point hasn't moved far from the
      //    last committed render (stale content is close enough).
      const lastPt = lastRenderScreenPtRef.current
      if (lastPt)
      {
        const dx = screenPoint.x - lastPt.x
        const dy = screenPoint.y - lastPt.y
        if (dx * dx + dy * dy < RENDER_SKIP_PX * RENDER_SKIP_PX) return
      }

      // 3. Velocity-adaptive debounce: render when slow/stopped, defer when
      //    the pointer is moving fast to avoid wasted renders.
      const now = Date.now()
      const prevPt = lastEventPointRef.current
      const dt = now - lastEventTimeRef.current
      let speedPxPerMs = 0
      if (prevPt && dt > 0)
      {
        const dx = screenPoint.x - prevPt.x
        const dy = screenPoint.y - prevPt.y
        speedPxPerMs = Math.sqrt(dx * dx + dy * dy) / dt
      }
      lastEventPointRef.current = screenPoint
      lastEventTimeRef.current = now

      // Fast movement: wait 180 ms; moderate: 60 ms; slow/stopped: fire immediately.
      const debounceMs = speedPxPerMs > 2 ? 180 : speedPxPerMs > 0.6 ? 60 : 0

      if (debounceMs === 0)
      {
        renderLoupeRef.current(screenPoint)
      }
      else
      {
        debounceTimerRef.current = setTimeout(() =>
        {
          renderLoupeRef.current(screenPoint)
        }, debounceMs)
      }
    }

    document.addEventListener(LOUPE_POINT_EVENT, handleLoupePoint)
    return () => document.removeEventListener(LOUPE_POINT_EVENT, handleLoupePoint)
  }, [])

  // PdfLoupe renders nothing into the React tree — the canvas is imperative.
  return null
}
