export default function Filters() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg">
      {/* Erosion filters - make lines thicker by expanding dark pixels */}
      <filter id="erode0">
        {/* No erosion, just pass through */}
        <feOffset in="SourceGraphic" dx="0" dy="0" />
      </filter>
      <filter id="erode1">
        <feMorphology operator="erode" radius="1" />
      </filter>
      <filter id="erode2">
        <feMorphology operator="erode" radius="2" />
      </filter>
      <filter id="erode3">
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
    </svg>
  );
}
