// pixel-processor.worker.ts
// Off-main-thread pixel processing for Safari. Receives raw ImageData pixels,
// applies erosion + line enhancement + optional recolouring, creates an
// ImageBitmap (GPU texture), then transfers it to the main thread.
// By creating the ImageBitmap here, we avoid any blocking GPU upload on the
// main thread — the main thread only needs to call ctx.drawImage(bitmap).

import { erodeImageData, enhanceLineQualityFast, recolourImageData } from "./erode";

export interface PixelProcessRequest {
  /** Monotonically increasing ID so stale responses can be discarded. */
  id: number;
  buffer: ArrayBuffer;
  width: number;
  height: number;
  erosions: number;
  recolourHex?: string;
}

export interface PixelProcessResponse {
  id: number;
  bitmap: ImageBitmap;
}

self.addEventListener("message", async (e: MessageEvent<PixelProcessRequest>) => {
  const { id, buffer, width, height, erosions, recolourHex } = e.data;

  let result = new ImageData(new Uint8ClampedArray(buffer), width, height);

  if (erosions > 0) {
    let scratch = new ImageData(width, height);
    for (let i = 0; i < erosions; i++) {
      erodeImageData(result, scratch);
      [result, scratch] = [scratch, result];
    }
  }

  enhanceLineQualityFast(result, 2, 1.5);

  if (recolourHex) {
    recolourImageData(result, recolourHex);
  }

  // Convert to ImageBitmap here in the worker so the main thread gets a
  // GPU-ready texture and never has to call createImageBitmap itself.
  const bitmap = await createImageBitmap(result);

  const response: PixelProcessResponse = { id, bitmap };
  (self as unknown as Worker).postMessage(response, [bitmap]);
});
