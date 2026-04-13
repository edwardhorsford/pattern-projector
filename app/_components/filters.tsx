export default function Filters() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg">
      <filter id="erode-1">
        <feMorphology operator="erode" radius="1" />
      </filter>
      <filter id="erode-2">
        <feMorphology operator="erode" radius="2" />
      </filter>
      <filter id="erode-3">
        <feMorphology operator="erode" radius="3" />
      </filter>

      {/* Push dark grey pixels toward black using gamma correction.
          After erosion, anti-aliased edges become grey. This filter
          darkens those greys back toward black so lines appear solid. */}
      <filter id="push-darks">
        <feComponentTransfer>
          <feFuncR type="gamma" amplitude="1" exponent="2" offset="0" />
          <feFuncG type="gamma" amplitude="1" exponent="2" offset="0" />
          <feFuncB type="gamma" amplitude="1" exponent="2" offset="0" />
        </feComponentTransfer>
      </filter>
    </svg>
  );
}
