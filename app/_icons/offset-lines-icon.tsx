// offset-lines-icon.tsx
export default function OffsetLinesIcon({ ariaLabel }: { ariaLabel: string }) {
  return (
    <svg
      aria-label={ariaLabel}
      xmlns="http://www.w3.org/2000/svg"
      height="24"
      viewBox="0 0 24 24"
      width="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      {/* Solid source line */}
      <line x1="2" y1="12" x2="22" y2="12" />
      {/* Dashed offset lines */}
      <line x1="2" y1="4" x2="22" y2="4" strokeDasharray="2 4" />
      <line x1="2" y1="20" x2="22" y2="20" strokeDasharray="2 4" />
    </svg>
  );
}
