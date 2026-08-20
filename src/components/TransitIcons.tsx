/**
 * Transit mode icons — the official Berlin signage marks (U-Bahn, S-Bahn,
 * Tram, Bus), served from the CDN and rendered as images.
 */

import busAsset from "@/assets/bus.png.asset.json";
import sbahnAsset from "@/assets/sbahn.png.asset.json";
import tramAsset from "@/assets/tram.png.asset.json";
import ubahnAsset from "@/assets/ubahn.png.asset.json";

export type TransitIconProps = {
  size?: number;
  className?: string;
  /** Kept for API compatibility; the official marks have a single appearance. */
  variant?: "filled" | "outline";
};

function Mark({
  src,
  alt,
  size = 24,
  className,
}: {
  src: string;
  alt: string;
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      className={className}
      style={{ width: size, height: size, objectFit: "contain" }}
    />
  );
}

export function UBahnIcon({ size, className }: TransitIconProps) {
  return <Mark src={ubahnAsset.url} alt="U-Bahn" size={size} className={className} />;
}

export function SBahnIcon({ size, className }: TransitIconProps) {
  return <Mark src={sbahnAsset.url} alt="S-Bahn" size={size} className={className} />;
}

export function TramIcon({ size, className }: TransitIconProps) {
  return <Mark src={tramAsset.url} alt="Tram" size={size} className={className} />;
}

export function BusIcon({ size, className }: TransitIconProps) {
  return <Mark src={busAsset.url} alt="Bus" size={size} className={className} />;
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
