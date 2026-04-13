export function erosionFilter(erosions: number): string {
  if (erosions <= 0) {
    return "none";
  }
  const result = [];
  while (erosions > 0) {
    if (erosions >= 3) {
      result.push("url(#erode-3)");
      erosions -= 3;
    } else if (erosions >= 2) {
      result.push("url(#erode-2)");
      erosions -= 2;
    } else {
      result.push("url(#erode-1)");
      erosions -= 1;
    }
  }
  // Push grey anti-aliased edges back toward black, then boost contrast.
  // This counteracts the blurring/fading that feMorphology introduces.
  result.push("url(#push-darks)");
  result.push("contrast(1.5)");
  return result.join(" ");
}

// Cached lookup table for fast gamma + contrast transformation.
let _lut: Uint8Array | null = null;
let _lutGamma: number | null = null;
let _lutContrast: number | null = null;

/**
 * Fast enhancement using a lookup table: applies gamma correction to darken
 * midtones toward black, then a contrast boost to separate lines from background.
 * Used on Safari where SVG filter references on canvas CSS aren't supported.
 * The LUT is built once and reused, making it 10-100× faster than Math.pow() per pixel.
 */
export function enhanceLineQualityFast(
  imageData: ImageData,
  gamma: number = 2,
  contrast: number = 1.5,
) {
  if (_lut === null || _lutGamma !== gamma || _lutContrast !== contrast) {
    _lut = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      let v = i / 255;
      v = Math.pow(v, gamma);
      v = (v - 0.5) * contrast + 0.5;
      _lut[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
    _lutGamma = gamma;
    _lutContrast = contrast;
  }
  const data = imageData.data;
  const len = data.length;
  for (let i = 0; i < len; i += 4) {
    data[i] = _lut[data[i]];
    data[i + 1] = _lut[data[i + 1]];
    data[i + 2] = _lut[data[i + 2]];
    // Alpha unchanged
  }
}

export function erodeImageData(imageData: ImageData, output: ImageData) {
  const { width, height } = imageData;
  const erodedData = output.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      for (let i = 0; i < 4; i++) {
        erodedData[index + i] = erodeAtIndex(
          imageData,
          x,
          y,
          index + i,
          width,
          height,
        );
      }
    }
  }
}

function erodeAtIndex(
  imageData: ImageData,
  x: number,
  y: number,
  index: number,
  width: number,
  height: number,
): number {
  const { data } = imageData;
  let c = data[index];
  if (x > 0) {
    const n = data[index - 4];
    if (n < c) {
      c = n;
    }
  }
  if (x < width - 1) {
    const n = data[index + 4];
    if (n < c) {
      c = n;
    }
  }
  if (y > 0) {
    const n = data[index - width * 4];
    if (n < c) {
      c = n;
    }
  }
  if (y < height - 1) {
    const n = data[index + width * 4];
    if (n < c) {
      c = n;
    }
  }
  return c;
}
