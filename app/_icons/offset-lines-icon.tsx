// offset-lines-icon.tsx
export default function OffsetLinesIcon({
  ariaLabel,
}: {
  ariaLabel: string
}) {
  return (
    <svg
      aria-label={ariaLabel}
      xmlns="http://www.w3.org/2000/svg"
      height="24"
      viewBox="0 -960 960 960"
      width="24"
      fill="currentColor"
    >
      {/* Two parallel horizontal lines with a double-headed arrow showing the gap */}
      <path d="M80-680h800v80H80v-80zm0 380h800v80H80v-80zM440-600v280h80v-280h-80zm40-80-100 80h200l-100-80zm0 440 100-80H380l100 80z" />
    </svg>
  )
}
