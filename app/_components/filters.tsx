/** Default intercept (floor) used when colourLift is not provided. */
const DEFAULT_COLOUR_LIFT = 0.25;

/**
 * Parse a hex colour string to 0-1 RGB values.
 */
function hexToUnit(hex: string): { r: number; g: number; b: number } {
  const v = hex.replace("#", "");
  const n = v.length === 3 ? `${v[0]}${v[0]}${v[1]}${v[1]}${v[2]}${v[2]}` : v;
  const parsed = Number.parseInt(n, 16);
  return {
    r: ((parsed >> 16) & 255) / 255,
    g: ((parsed >> 8) & 255) / 255,
    b: (parsed & 255) / 255,
  };
}

export default function Filters({
  colourLift = DEFAULT_COLOUR_LIFT,
  recolourHex,
}: {
  colourLift?: number;
  recolourHex?: string;
}) {
  // slope + intercept must sum to ≤ 1 so white (1.0) stays white.
  const slope = Math.max(0, 1 - colourLift);
  const intercept = colourLift;

  // Build the recolour feColorMatrix values string.
  // Maps black (0,0,0) → target colour and white (1,1,1) → black (0,0,0).
  // Intermediate greys map to proportionally dimmer shades of the target.
  // Matrix: out = -target * luminance(in) + target
  //   row R: [-tR*0.2126, -tR*0.7152, -tR*0.0722, 0, tR]
  //   row G: [-tG*0.2126, -tG*0.7152, -tG*0.0722, 0, tG]
  //   row B: [-tB*0.2126, -tB*0.7152, -tB*0.0722, 0, tB]
  //   row A: [0, 0, 0, 1, 0]
  let recolourValues = "";
  if (recolourHex) {
    const { r, g, b } = hexToUnit(recolourHex);
    recolourValues = [
      `${(-r * 0.2126).toFixed(4)} ${(-r * 0.7152).toFixed(4)} ${(-r * 0.0722).toFixed(4)} 0 ${r.toFixed(4)}`,
      `${(-g * 0.2126).toFixed(4)} ${(-g * 0.7152).toFixed(4)} ${(-g * 0.0722).toFixed(4)} 0 ${g.toFixed(4)}`,
      `${(-b * 0.2126).toFixed(4)} ${(-b * 0.7152).toFixed(4)} ${(-b * 0.0722).toFixed(4)} 0 ${b.toFixed(4)}`,
      "0 0 0 1 0",
    ].join("\n");
  }

  return (
    <svg xmlns="http://www.w3.org/2000/svg">
      {/* Erosion filters - make lines thicker by expanding dark pixels */}
      <filter id="erode-0">
        {/* No erosion, just pass through */}
        <feOffset in="SourceGraphic" dx="0" dy="0" />
      </filter>
      <filter id="erode-1">
        <feMorphology operator="erode" radius="1" />
      </filter>
      <filter id="erode-2">
        <feMorphology operator="erode" radius="2" />
      </filter>
      <filter id="erode-3">
        <feMorphology operator="erode" radius="3" />
      </filter>

      {/* Push darks toward black using component transfer */}
      <filter id="push-darks">
        <feComponentTransfer>
          {/* Gamma > 1 darkens midtones, pushing greys toward black */}
          <feFuncR type="gamma" amplitude="1" exponent="2" offset="0" />
          <feFuncG type="gamma" amplitude="1" exponent="2" offset="0" />
          <feFuncB type="gamma" amplitude="1" exponent="2" offset="0" />
        </feComponentTransfer>
      </filter>

      {/*
        Lift blacks before inversion so lines absorb theme colour.
        After push-darks+contrast, pattern lines are at 0 (pure black).
        This lifts the minimum to 0.35 so that after invert(1) they
        become ~0.65 (mid-bright grey) which absorbs sepia/hue-rotate
        colour strongly. White background (1.0) maps to 1.0 unchanged.
        slope = 1 - floor, intercept = floor.
      */}
      <filter id="lift-blacks" colorInterpolationFilters="sRGB">
        <feComponentTransfer>
          <feFuncR type="linear" slope={slope} intercept={intercept} />
          <feFuncG type="linear" slope={slope} intercept={intercept} />
          <feFuncB type="linear" slope={slope} intercept={intercept} />
        </feComponentTransfer>
      </filter>

      {/* Recolour filter: maps black → target colour, white → black,
          with luminance-proportional shading for greys. */}
      {recolourHex && (
        <filter id="recolor" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values={recolourValues} />
        </filter>
      )}
    </svg>
  );
}
