export default function MarkCompleteIcon({
  ariaLabel,
}: {
  ariaLabel: string;
}) {
  return (
    <svg
      aria-label={ariaLabel}
      xmlns="http://www.w3.org/2000/svg"
      height="24"
      viewBox="0 0 100 100"
      width="24"
      fill="currentColor"
    >
      {/* Thick circle with checkmark inside */}
      <circle
        cx="50"
        cy="50"
        r="42"
        fill="none"
        stroke="currentColor"
        strokeWidth="8"
      />
      <path
        d="M28 50 L44 66 L72 34"
        fill="none"
        stroke="currentColor"
        strokeWidth="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
