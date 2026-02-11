export default function Filters() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg">
      {/* Erosion filters - make lines thicker by expanding dark pixels */}
      <filter id="erode-1">
        <feMorphology operator="erode" radius="1" />
      </filter>
      <filter id="erode-2">
        <feMorphology operator="erode" radius="2" />
      </filter>
      <filter id="erode-3">
        <feMorphology operator="erode" radius="3" />
      </filter>

      {/* Sharpen filter - enhances edges before erosion to reduce blur */}
      <filter id="sharpen">
        <feConvolutionMatrix
          order="3"
          kernelMatrix="0 -1 0 -1 5 -1 0 -1 0"
          divisor="1"
          bias="0"
          preserveAlpha="true"
        />
      </filter>

      {/* Stronger sharpen for more aggressive edge enhancement */}
      <filter id="sharpen-strong">
        <feConvolutionMatrix
          order="3"
          kernelMatrix="-1 -1 -1 -1 9 -1 -1 -1 -1"
          divisor="1"
          bias="0"
          preserveAlpha="true"
        />
      </filter>

      {/* Unsharp mask - classic sharpening technique */}
      <filter id="unsharp-mask">
        <feGaussianBlur in="SourceGraphic" stdDeviation="1" result="blur" />
        <feComposite
          in="SourceGraphic"
          in2="blur"
          operator="arithmetic"
          k1="0"
          k2="1.5"
          k3="-0.5"
          k4="0"
        />
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

      {/* Gentle push - less aggressive darkening */}
      <filter id="push-darks-gentle">
        <feComponentTransfer>
          <feFuncR type="gamma" amplitude="1" exponent="1.5" offset="0" />
          <feFuncG type="gamma" amplitude="1" exponent="1.5" offset="0" />
          <feFuncB type="gamma" amplitude="1" exponent="1.5" offset="0" />
        </feComponentTransfer>
      </filter>

      {/* Strong push - very aggressive darkening */}
      <filter id="push-darks-strong">
        <feComponentTransfer>
          <feFuncR type="gamma" amplitude="1" exponent="3" offset="0" />
          <feFuncG type="gamma" amplitude="1" exponent="3" offset="0" />
          <feFuncB type="gamma" amplitude="1" exponent="3" offset="0" />
        </feComponentTransfer>
      </filter>

      {/* Combined filter: sharpen then erode then push darks */}
      <filter id="enhance-lines-1">
        {/* First sharpen */}
        <feConvolutionMatrix
          order="3"
          kernelMatrix="0 -1 0 -1 5 -1 0 -1 0"
          divisor="1"
          result="sharpened"
        />
        {/* Then erode */}
        <feMorphology
          operator="erode"
          radius="1"
          in="sharpened"
          result="eroded"
        />
        {/* Then push darks */}
        <feComponentTransfer in="eroded">
          <feFuncR type="gamma" amplitude="1" exponent="2" offset="0" />
          <feFuncG type="gamma" amplitude="1" exponent="2" offset="0" />
          <feFuncB type="gamma" amplitude="1" exponent="2" offset="0" />
        </feComponentTransfer>
      </filter>

      <filter id="enhance-lines-2">
        <feConvolutionMatrix
          order="3"
          kernelMatrix="0 -1 0 -1 5 -1 0 -1 0"
          divisor="1"
          result="sharpened"
        />
        <feMorphology
          operator="erode"
          radius="2"
          in="sharpened"
          result="eroded"
        />
        <feComponentTransfer in="eroded">
          <feFuncR type="gamma" amplitude="1" exponent="2" offset="0" />
          <feFuncG type="gamma" amplitude="1" exponent="2" offset="0" />
          <feFuncB type="gamma" amplitude="1" exponent="2" offset="0" />
        </feComponentTransfer>
      </filter>

      <filter id="enhance-lines-3">
        <feConvolutionMatrix
          order="3"
          kernelMatrix="0 -1 0 -1 5 -1 0 -1 0"
          divisor="1"
          result="sharpened"
        />
        <feMorphology
          operator="erode"
          radius="3"
          in="sharpened"
          result="eroded"
        />
        <feComponentTransfer in="eroded">
          <feFuncR type="gamma" amplitude="1" exponent="2" offset="0" />
          <feFuncG type="gamma" amplitude="1" exponent="2" offset="0" />
          <feFuncB type="gamma" amplitude="1" exponent="2" offset="0" />
        </feComponentTransfer>
      </filter>
    </svg>
  );
}
