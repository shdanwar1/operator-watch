export function Hourglass({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      className={`hourglass ${className ?? ""}`}
      aria-hidden
    >
      {/* Frame */}
      <path
        d="M12 4h24M12 44h24"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M14 4v6c0 5 8 8 8 14s-8 9-8 14v6M34 4v6c0 5-8 8-8 14s8 9 8 14v6"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinejoin="round"
      />
      {/* Sand top (drains) */}
      <path
        d="M16 6h16c0 4-6 7-8 12-2-5-8-8-8-12z"
        fill="currentColor"
        opacity="0.85"
        className="hourglass-sand-top"
      />
      {/* Falling stream */}
      <rect
        x="23.4"
        y="18"
        width="1.2"
        height="12"
        fill="currentColor"
        opacity="0.75"
        className="hourglass-sand-stream"
      />
      {/* Sand bottom (fills) */}
      <path
        d="M16 42h16c0-4-6-7-8-12-2 5-8 8-8 12z"
        fill="currentColor"
        opacity="0.85"
        className="hourglass-sand-bottom"
      />
    </svg>
  );
}
