/**
 * Transit mode icons — monochrome, drawn with `currentColor` so they inherit
 * the surrounding text colour and read correctly in light and dark mode.
 *
 * Shapes mirror the Berlin signage set (U-Bahn wordmark, S-Bahn roundel,
 * tram, bus) but stripped to black & white.
 */

export type TransitIconProps = {
  size?: number;
  className?: string;
  /** filled = solid badge with knocked-out glyph; outline = glyph only */
  variant?: "filled" | "outline";
};

function Frame({
  size = 24,
  className,
  children,
}: {
  size?: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** U-Bahn — squared badge with a U. */
export function UBahnIcon({ size, className, variant = "filled" }: TransitIconProps) {
  const filled = variant === "filled";
  return (
    <Frame size={size} className={className}>
      <rect
        x="1.5"
        y="1.5"
        width="21"
        height="21"
        rx="4"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={filled ? 0 : 1.6}
      />
      <path
        d="M8 6.4v7.1a4 4 0 0 0 8 0V6.4"
        stroke={filled ? "var(--color-background)" : "currentColor"}
        strokeWidth="2.6"
        strokeLinecap="square"
        fill="none"
      />
    </Frame>
  );
}

/** S-Bahn — roundel with an S and an inner ring. */
export function SBahnIcon({ size, className, variant = "filled" }: TransitIconProps) {
  const filled = variant === "filled";
  return (
    <Frame size={size} className={className}>
      <circle
        cx="12"
        cy="12"
        r="10.5"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={filled ? 0 : 1.6}
      />
      {filled && <circle cx="12" cy="12" r="8.6" fill="none" stroke="var(--color-background)" strokeWidth="1.1" />}
      <path
        d="M15 8.1a4.6 4.6 0 0 0-3.2-1.2c-1.8 0-3 1-3 2.3 0 1.4 1.2 2 3.1 2.6 2 .6 3.3 1.3 3.3 2.9 0 1.5-1.4 2.5-3.4 2.5A5 5 0 0 1 8.6 16"
        stroke={filled ? "var(--color-background)" : "currentColor"}
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
    </Frame>
  );
}

/** Tram — pantograph, windowed car, wheels on rails. */
export function TramIcon({ size, className, variant = "filled" }: TransitIconProps) {
  const filled = variant === "filled";
  const glyph = filled ? "var(--color-background)" : "currentColor";
  return (
    <Frame size={size} className={className}>
      {filled && <circle cx="12" cy="12" r="11" fill="currentColor" />}
      {!filled && <circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" strokeWidth="1.6" />}
      <g stroke={glyph} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M8.6 5.2 12 3.6l3.4 1.6" />
        <path d="M12 3.6v1.9" />
        <rect x="6.4" y="5.9" width="11.2" height="11" rx="2.2" />
        <rect x="8.6" y="8" width="6.8" height="4" rx="0.8" fill={glyph} stroke="none" />
        <circle cx="9.4" cy="14.4" r="1" fill={glyph} stroke="none" />
        <circle cx="14.6" cy="14.4" r="1" fill={glyph} stroke="none" />
        <path d="M8.6 16.9 7.3 19.6M15.4 16.9l1.3 2.7M5.6 19.6h12.8" />
      </g>
    </Frame>
  );
}

/** Bus — rounded body, windscreen band, wheels. */
export function BusIcon({ size, className, variant = "filled" }: TransitIconProps) {
  const filled = variant === "filled";
  const glyph = filled ? "var(--color-background)" : "currentColor";
  return (
    <Frame size={size} className={className}>
      {filled && <circle cx="12" cy="12" r="11" fill="currentColor" />}
      {!filled && <circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" strokeWidth="1.6" />}
      <g stroke={glyph} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M6.2 10.2a5.8 5.8 0 0 1 5.8-5.4 5.8 5.8 0 0 1 5.8 5.4v6.5a1.4 1.4 0 0 1-1.4 1.4H7.6a1.4 1.4 0 0 1-1.4-1.4z" />
        <rect x="8.4" y="6.6" width="7.2" height="1.5" rx="0.7" fill={glyph} stroke="none" />
        <rect x="8.2" y="9.6" width="7.6" height="3.6" rx="0.9" fill={glyph} stroke="none" />
        <circle cx="9.3" cy="15.4" r="1" fill={glyph} stroke="none" />
        <circle cx="14.7" cy="15.4" r="1" fill={glyph} stroke="none" />
        <path d="M8.3 18.1v1.1M15.7 18.1v1.1" />
      </g>
    </Frame>
  );
}

/** Resolve a provider mode string to an icon component. */
export function transitIconFor(mode: string) {
  switch (mode) {
    case "subway":
      return UBahnIcon;
    case "suburban":
    case "regional":
    case "express":
      return SBahnIcon;
    case "tram":
      return TramIcon;
    default:
      return BusIcon;
  }
}
