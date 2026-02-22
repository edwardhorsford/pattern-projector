/** Default intercept (floor) used when colourLift is not provided. */
const DEFAULT_COLOUR_LIFT = 0.25;

export default function Filters({
  colourLift = DEFAULT_COLOUR_LIFT,
}: {
  colourLift?: number;
}) {
  // slope + intercept must sum to ≤ 1 so white (1.0) stays white.
  const slope = Math.max(0, 1 - colourLift);
  const intercept = colourLift;

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
    </svg>
  );
}
