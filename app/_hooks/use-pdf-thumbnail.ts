"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { pdfjs } from "react-pdf";
import { getPageNumbers, getRowsColumns } from "@/_lib/get-page-numbers";
import {
  StitchSettings,
  LineDirection,
} from "@/_lib/interfaces/stitch-settings";
import { Layers } from "@/_lib/layers";
import type {
  PixelProcessRequest,
  PixelProcessResponse,
} from "@/_lib/pixel-processor.worker";

// Module-level cache: thumbnail data URLs keyed by rendering parameters.
// Avoids re-processing identical settings we've seen before.
const thumbnailCache = new Map<string, string>();
const MAX_THUMBNAIL_CACHE_SIZE = 30;

function addToThumbnailCache(key: string, dataUrl: string) {
  if (thumbnailCache.size >= MAX_THUMBNAIL_CACHE_SIZE) {
    const firstKey = thumbnailCache.keys().next().value;
    if (firstKey) thumbnailCache.delete(firstKey);
  }
  thumbnailCache.set(key, dataUrl);
}

// Stable empty object for default layers parameter
// Using a constant prevents creating a new object reference on each render
const EMPTY_LAYERS: Layers = {};

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.js",
  import.meta.url,
).toString();

// Maximum thumbnail dimension (width or height)
// Using larger size for better quality in enlarged mini map view
const MAX_THUMBNAIL_SIZE = 1200;

// Internal render multiplier - render at higher resolution then scale down
// This helps preserve thin lines that would otherwise be sub-pixel
const RENDER_SCALE_MULTIPLIER = 3;

// Base erosion to apply when line weight is 0, to keep lines visible at thumbnail scale
const THUMBNAIL_BASE_EROSION = 1;

/**
 * Encode an ImageData to a JPEG data URL.
 */
function encodeToJpeg(source: ImageData): string {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(source, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.85);
}

/**
 * Hook to generate a low-resolution thumbnail of a PDF file.
 * The thumbnail shows all pages stitched together according to stitch settings.
 * Applies line thickness (erosion) to make faint lines more visible.
 *
 * The thumbnail is cached - toggling 'enabled' doesn't regenerate it.
 * Only regenerates when file or relevant settings change.
 *
 * Returns an object with:
 * - thumbnail: The data URL of the thumbnail image, or null if not ready
 * - isLoading: Whether the thumbnail is currently being generated
 */
export function usePdfThumbnail(
  file: File | null,
  pageCount: number,
  stitchSettings: StitchSettings,
  lineThickness: number,
  enabled: boolean = true,
  layers: Layers = EMPTY_LAYERS,
  renderVersion: number = 0,
): { thumbnail: string | null; isLoading: boolean } {
  const [cachedThumbnail, setCachedThumbnail] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Create stable key for layers to avoid unnecessary re-renders
  // Layers object reference can change even when contents are the same
  const layersKey = useMemo(
    () =>
      JSON.stringify(
        Object.entries(layers).map(([id, layer]) => [id, layer.visible]),
      ),
    [layers],
  );

  // Re-renders the full PDF when file/layout/thickness changes.
  useEffect(() => {
    // Only regenerate if file or settings change, not when enabled toggles
    if (!file || pageCount === 0) {
      setCachedThumbnail(null);
      setIsLoading(false);
      return;
    }

    // Cancel any previous render
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setIsLoading(true);

    async function generateThumbnail() {
      // Build a cache key from all parameters that affect the output.
      const cacheKey = `${file!.name}-${file!.size}-${pageCount}-${stitchSettings.pageRange}-${stitchSettings.lineCount}-${stitchSettings.lineDirection}-${lineThickness}-${renderVersion}-${layersKey}`;

      // Return cached result immediately if available — avoids all re-processing.
      const cached = thumbnailCache.get(cacheKey);
      if (cached) {
        setCachedThumbnail(cached);
        setIsLoading(false);
        return;
      }

      try {
        // Load the PDF document
        const arrayBuffer = await file!.arrayBuffer();
        if (signal.aborted) return;

        const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        if (signal.aborted) return;

        // Get page layout info
        const pages = getPageNumbers(stitchSettings.pageRange, pageCount);
        const [rows, columns] = getRowsColumns(
          pages,
          stitchSettings.lineCount,
          stitchSettings.lineDirection,
        );

        // Get page dimensions (use first page as reference)
        const firstPageNum = pages.find((p) => p > 0) || 1;
        const firstPage = await pdf.getPage(firstPageNum);
        if (signal.aborted) return;

        const userUnit = firstPage.userUnit || 1;
        const pageViewport = firstPage.getViewport({ scale: 1 });
        const pageWidth = pageViewport.width * userUnit;
        const pageHeight = pageViewport.height * userUnit;

        // Calculate total layout size
        const totalWidth = pageWidth * columns;
        const totalHeight = pageHeight * rows;

        // Calculate scale to fit in thumbnail size
        const outputScale = Math.min(
          MAX_THUMBNAIL_SIZE / totalWidth,
          MAX_THUMBNAIL_SIZE / totalHeight,
          1, // Don't upscale
        );

        // Render at higher resolution to preserve thin lines
        const renderScale = outputScale * RENDER_SCALE_MULTIPLIER;

        const thumbWidth = Math.ceil(totalWidth * outputScale);
        const thumbHeight = Math.ceil(totalHeight * outputScale);
        const renderWidth = Math.ceil(totalWidth * renderScale);
        const renderHeight = Math.ceil(totalHeight * renderScale);
        const tileWidth = Math.ceil(pageWidth * renderScale);
        const tileHeight = Math.ceil(pageHeight * renderScale);

        // Create high-res canvas for rendering
        const renderCanvas = document.createElement("canvas");
        renderCanvas.width = renderWidth;
        renderCanvas.height = renderHeight;
        const renderCtx = renderCanvas.getContext("2d");
        if (!renderCtx) return;

        // Fill with white background
        renderCtx.fillStyle = "#ffffff";
        renderCtx.fillRect(0, 0, renderWidth, renderHeight);

        // Render each page at high resolution
        const pdfRenderScale = renderScale * userUnit;

        for (let i = 0; i < pages.length; i++) {
          if (signal.aborted) return;

          const pageNum = pages[i];
          if (pageNum === 0) continue; // Skip blank pages

          // Calculate position based on grid layout
          let col: number, row: number;
          if (stitchSettings.lineDirection === LineDirection.Row) {
            col = Math.floor(i / rows);
            row = i % rows;
          } else {
            col = i % columns;
            row = Math.floor(i / columns);
          }

          const x = col * tileWidth;
          const y = row * tileHeight;

          const page = await pdf.getPage(pageNum);
          if (signal.aborted) return;

          const viewport = page.getViewport({ scale: pdfRenderScale });

          // Create a temporary canvas for this page
          const pageCanvas = document.createElement("canvas");
          pageCanvas.width = Math.ceil(viewport.width);
          pageCanvas.height = Math.ceil(viewport.height);
          const pageCtx = pageCanvas.getContext("2d");
          if (!pageCtx) continue;

          // Get optional content config and apply layer visibility
          const optionalContentConfig = await pdf.getOptionalContentConfig();
          for (const layer of Object.values(layers)) {
            for (const id of layer.ids) {
              optionalContentConfig.setVisibility(id, layer.visible);
            }
          }

          // Render the page with layer visibility settings
          await page.render({
            canvasContext: pageCtx,
            viewport: viewport,
            optionalContentConfigPromise: Promise.resolve(
              optionalContentConfig,
            ),
          }).promise;

          if (signal.aborted) return;

          // Draw onto high-res canvas
          renderCtx.drawImage(pageCanvas, x, y, tileWidth, tileHeight);
        }

        // Process pixels off-thread (erode + enhance) using the pixel-processor worker.
        // The worker always runs enhanceLineQualityFast, and erodes if erosions > 0.
        const effectiveErosion =
          lineThickness === 0 ? THUMBNAIL_BASE_EROSION : lineThickness;
        const totalErosion = effectiveErosion * RENDER_SCALE_MULTIPLIER;
        const rawImageData = renderCtx.getImageData(0, 0, renderWidth, renderHeight);
        const processedBitmap = await new Promise<ImageBitmap>((resolve, reject) => {
          if (signal.aborted) { reject(new DOMException("Aborted")); return; }
          const worker = new Worker(
            new URL("../_lib/pixel-processor.worker", import.meta.url),
          );
          const onAbort = () => { worker.terminate(); reject(new DOMException("Aborted")); };
          signal.addEventListener("abort", onAbort);
          worker.onmessage = (e: MessageEvent<PixelProcessResponse>) => {
            signal.removeEventListener("abort", onAbort);
            worker.terminate();
            resolve(e.data.bitmap);
          };
          const request: PixelProcessRequest = {
            id: 1,
            buffer: rawImageData.data.buffer,
            width: renderWidth,
            height: renderHeight,
            erosions: totalErosion,
          };
          worker.postMessage(request, [request.buffer]);
        });
        if (signal.aborted) { processedBitmap.close(); return; }

        // Draw the processed result back onto the high-res canvas for downscaling.
        renderCtx.drawImage(processedBitmap, 0, 0);
        processedBitmap.close();

        // Create final thumbnail canvas and scale down
        const canvas = document.createElement("canvas");
        canvas.width = thumbWidth;
        canvas.height = thumbHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Draw scaled-down version with high quality smoothing
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(renderCanvas, 0, 0, thumbWidth, thumbHeight);

        const finalImageData = ctx.getImageData(0, 0, thumbWidth, thumbHeight);
        const dataUrl = encodeToJpeg(finalImageData);

        if (!signal.aborted) {
          addToThumbnailCache(cacheKey, dataUrl);
          setCachedThumbnail(dataUrl);
          setIsLoading(false);
        }
      } catch (error) {
        if (!signal.aborted) {
          console.error("Error generating PDF thumbnail:", error);
          setCachedThumbnail(null);
          setIsLoading(false);
        }
      }
    }

    generateThumbnail();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- layersKey is a stable derived key from layers; using layers directly would cause spurious re-runs
  }, [
    file,
    pageCount,
    stitchSettings.pageRange,
    stitchSettings.lineCount,
    stitchSettings.lineDirection,
    lineThickness,
    layersKey,
    renderVersion,
  ]);
  // Note: 'enabled' is NOT in the dep array — it uses the cache.

  // Return the cached thumbnail only if enabled, and loading state
  return {
    thumbnail: enabled ? cachedThumbnail : null,
    isLoading: isLoading && enabled,
  };
}
