export function erosionFilter(
  erosions: number,
  /**
   * Colour lift floor (0–1). Pass `displaySettings.colourLift` for colour themes
   * (Green/Cyan/Amber/Magenta); pass 0 for Light and Dark themes where no lift
   * is wanted. When non-zero, `url(#lift-blacks)` is appended so the floor step
   * runs on the canvas draw call rather than in the container CSS filter — this
   * prevents Safari from dropping the whole filter if the SVG ref is unresolvable.
   */
  colourLift: number = 0,
  /**
   * When true, append `url(#recolor)` instead of `url(#lift-blacks)`.
   * The recolor SVG filter maps black→target colour and white→black directly
   * via a feColorMatrix, replacing the old invert+sepia+hue-rotate approach.
   */
  useRecolour: boolean = false,
): string {
  const result = [];

  // Apply erosion filters if needed
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

  // Always add push-darks and contrast for better line quality
  result.push("url(#push-darks)");
  result.push("contrast(1.5)");

  if (useRecolour) {
    // Use the feColorMatrix recolour filter which does invert+colourise in one step.
    // This replaces both lift-blacks and the container invert+sepia+hue-rotate filters.
    result.push("url(#recolor)");
  } else if (colourLift > 0) {
    // Legacy path: lift blacks before container-level invert+sepia+hue-rotate.
    result.push("url(#lift-blacks)");
  }
  return result.join(" ");
}

/**
 * Generate an enhanced line filter string that combines sharpen, erode, and push-darks.
 * This produces better quality than plain erosion.
 *
 * @param lineThickness - The amount of thickening (0-6+)
 * @returns CSS filter string
 */
export function enhancedLineFilter(lineThickness: number): string {
  if (lineThickness <= 0) {
    return "none";
  }

  // Use the combined enhance-lines filters for 1-3
  if (lineThickness <= 3) {
    return `url(#enhance-lines-${lineThickness})`;
  }

  // For higher values, chain the highest combined filter with additional erosion
  const base = "url(#enhance-lines-3)";
  let remaining = lineThickness - 3;
  const additional: string[] = [];

  while (remaining > 0) {
    if (remaining >= 3) {
      additional.push("url(#erode-3)");
      remaining -= 3;
    } else if (remaining >= 2) {
      additional.push("url(#erode-2)");
      remaining -= 2;
    } else {
      additional.push("url(#erode-1)");
      remaining -= 1;
    }
  }

  return [base, ...additional].join(" ");
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

// Apply threshold to push greys to black or white after erosion
export function thresholdImageData(
  imageData: ImageData,
  threshold: number = 128,
) {
  const { data, width, height } = imageData;
  for (let i = 0; i < width * height * 4; i += 4) {
    // Calculate luminance from RGB
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    const value = luminance < threshold ? 0 : 255;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    // Keep alpha as-is
  }
}

// Apply contrast boost to push greys toward black/white while preserving some anti-aliasing
export function contrastImageData(imageData: ImageData, factor: number = 2) {
  const { data, width, height } = imageData;
  for (let i = 0; i < width * height * 4; i += 4) {
    // Apply contrast around midpoint (128)
    for (let c = 0; c < 3; c++) {
      const value = data[i + c];
      const adjusted = (value - 128) * factor + 128;
      data[i + c] = Math.max(0, Math.min(255, Math.round(adjusted)));
    }
    // Keep alpha as-is
  }
}

/**
 * Combined push-darks and contrast in a single pass for better performance.
 * Applies gamma correction to darken midtones, then contrast boost.
 */
export function enhanceLineQuality(
  imageData: ImageData,
  gamma: number = 2,
  contrast: number = 1.5,
) {
  const { data, width, height } = imageData;
  const len = width * height * 4;

  for (let i = 0; i < len; i += 4) {
    for (let c = 0; c < 3; c++) {
      let value = data[i + c] / 255;

      // Apply gamma (> 1 darkens midtones)
      value = Math.pow(value, gamma);

      // Apply contrast around midpoint
      value = (value - 0.5) * contrast + 0.5;

      // Clamp and convert back to 0-255
      data[i + c] = Math.max(0, Math.min(255, Math.round(value * 255)));
    }
    // Keep alpha as-is
  }
}

// Cached lookup tables for fast enhancement
let cachedLUT: Uint8Array | null = null;
let cachedLUTParams: { gamma: number; contrast: number; floor: number } | null =
  null;

/**
 * Build a lookup table for gamma + contrast + floor transformation.
 * This precomputes all 256 possible output values.
 * @param floor - Minimum output value (0-1). Lifts blacks so lines absorb colour after inversion.
 */
function buildEnhancementLUT(
  gamma: number,
  contrast: number,
  floor: number = 0,
): Uint8Array {
  // Return cached LUT if params match
  if (
    cachedLUT &&
    cachedLUTParams?.gamma === gamma &&
    cachedLUTParams?.contrast === contrast &&
    cachedLUTParams?.floor === floor
  ) {
    return cachedLUT;
  }

  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i / 255;
    // Apply gamma (> 1 darkens midtones)
    value = Math.pow(value, gamma);
    // Apply contrast around midpoint
    value = (value - 0.5) * contrast + 0.5;
    // Lift floor so lines absorb theme colour after inversion
    value = Math.max(value, floor);
    // Clamp and convert to 0-255
    lut[i] = Math.max(0, Math.min(255, Math.round(value * 255)));
  }

  cachedLUT = lut;
  cachedLUTParams = { gamma, contrast, floor };
  return lut;
}

/**
 * Fast enhancement using a lookup table.
 * Much faster than enhanceLineQuality because it avoids Math.pow() per pixel.
 * Use this for Safari where we need pixel-by-pixel processing.
 * @param floor - Minimum output value (0-1). Pass colourLift value for colour themes, 0 otherwise.
 */
export function enhanceLineQualityFast(
  imageData: ImageData,
  gamma: number = 2,
  contrast: number = 1.5,
  floor: number = 0,
) {
  const lut = buildEnhancementLUT(gamma, contrast, floor);
  const data = imageData.data;
  const len = data.length;

  // Process 4 bytes at a time (RGBA), only transform RGB
  for (let i = 0; i < len; i += 4) {
    data[i] = lut[data[i]]; // R
    data[i + 1] = lut[data[i + 1]]; // G
    data[i + 2] = lut[data[i + 2]]; // B
    // Alpha unchanged
  }
}

/**
 * Apply a levels adjustment to push dark colors darker while preserving anti-aliasing.
 * This is gentler than a hard threshold - it compresses the tonal range.
 *
 * @param imageData - The image data to modify
 * @param blackPoint - Input values below this become black (0-255, default 0)
 * @param whitePoint - Input values above this become white (0-255, default 255)
 * @param gamma - Gamma adjustment (< 1 = darker midtones, > 1 = lighter midtones, default 1)
 * @param outputBlack - Output black level (0-255, default 0)
 * @param outputWhite - Output white level (0-255, default 255)
 */
export function levelsImageData(
  imageData: ImageData,
  blackPoint: number = 0,
  whitePoint: number = 255,
  gamma: number = 1,
  outputBlack: number = 0,
  outputWhite: number = 255,
) {
  const { data, width, height } = imageData;
  const inputRange = whitePoint - blackPoint;
  const outputRange = outputWhite - outputBlack;

  for (let i = 0; i < width * height * 4; i += 4) {
    for (let c = 0; c < 3; c++) {
      let value = data[i + c];

      // Map input range to 0-1
      value = Math.max(0, Math.min(1, (value - blackPoint) / inputRange));

      // Apply gamma
      value = Math.pow(value, 1 / gamma);

      // Map to output range
      value = outputBlack + value * outputRange;

      data[i + c] = Math.max(0, Math.min(255, Math.round(value)));
    }
    // Keep alpha as-is
  }
}

/**
 * Push dark pixels toward pure black using a curve.
 * Pixels darker than the threshold get pushed more aggressively toward black.
 * This preserves anti-aliasing edges while making lines more solid.
 *
 * @param imageData - The image data to modify
 * @param threshold - Luminance threshold (0-255). Pixels darker than this get pushed toward black.
 * @param strength - How aggressively to push toward black (0-1, where 1 = fully black below threshold)
 */
export function pushDarksToBlack(
  imageData: ImageData,
  threshold: number = 200,
  strength: number = 0.8,
) {
  const { data, width, height } = imageData;

  for (let i = 0; i < width * height * 4; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

    if (luminance < threshold) {
      // Calculate how much to darken based on how dark it already is
      // Darker pixels get pushed more toward black
      const darknessRatio = 1 - luminance / threshold; // 0 at threshold, 1 at black
      const pushAmount = darknessRatio * strength;

      // Interpolate toward black
      data[i] = Math.round(r * (1 - pushAmount));
      data[i + 1] = Math.round(g * (1 - pushAmount));
      data[i + 2] = Math.round(b * (1 - pushAmount));
    }
    // Keep alpha and pixels above threshold as-is
  }
}

/**
 * Apply an S-curve to increase contrast while preserving smooth gradients.
 * This is similar to Photoshop's "S-curve" in Curves adjustment.
 *
 * @param imageData - The image data to modify
 * @param intensity - Intensity of the S-curve (0-1, where 0 = no change, 1 = maximum contrast)
 */
export function sCurveContrast(imageData: ImageData, intensity: number = 0.5) {
  const { data, width, height } = imageData;

  for (let i = 0; i < width * height * 4; i += 4) {
    for (let c = 0; c < 3; c++) {
      let value = data[i + c] / 255; // Normalize to 0-1

      // Apply S-curve using sine function
      // sin gives a nice smooth curve that darkens darks and lightens lights
      const curved = 0.5 - Math.cos(value * Math.PI) / 2;

      // Blend between original and curved based on intensity
      value = value * (1 - intensity) + curved * intensity;

      data[i + c] = Math.max(0, Math.min(255, Math.round(value * 255)));
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

/**
 * Recolour image data in-place: maps pixel luminance to a target colour.
 * Black (luminance 0) → target colour at full intensity.
 * White (luminance 1) → black (0, 0, 0).
 * Greys map to proportionally dimmer shades of the target.
 * This is the pixel-level equivalent of the feColorMatrix recolour SVG filter.
 *
 * @param imageData - The image data to recolour in-place.
 * @param hex - Target colour as a hex string (e.g. "#75FFCD").
 */
export function recolourImageData(imageData: ImageData, hex: string) {
  const v = hex.replace("#", "");
  const n = v.length === 3 ? `${v[0]}${v[0]}${v[1]}${v[1]}${v[2]}${v[2]}` : v;
  const parsed = Number.parseInt(n, 16);
  const tR = ((parsed >> 16) & 255) / 255;
  const tG = ((parsed >> 8) & 255) / 255;
  const tB = (parsed & 255) / 255;

  const data = imageData.data;
  const len = data.length;

  for (let i = 0; i < len; i += 4) {
    // Compute luminance from the source pixel (already enhanced via LUT)
    const luminance =
      (data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722) / 255;
    // Invert: black (0) → full colour, white (1) → black
    const intensity = 1 - luminance;
    data[i] = Math.round(intensity * tR * 255); // R
    data[i + 1] = Math.round(intensity * tG * 255); // G
    data[i + 2] = Math.round(intensity * tB * 255); // B
    // Alpha unchanged
  }
}
