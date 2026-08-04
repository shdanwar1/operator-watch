import { useEffect, useMemo, useRef, useState } from "react";
import { Briefcase, Home } from "lucide-react";

type Pt = { lat: number; lng: number };

const TILE = 256;

function project(p: Pt, z: number) {
  const scale = TILE * Math.pow(2, z);
  const x = ((p.lng + 180) / 360) * scale;
  const s = Math.sin((p.lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale;
  return { x, y };
}

/**
 * Lightweight, non-interactive route preview: OSM raster tiles with a
 * home → studio line drawn on top. No map SDK, no API key, no controls.
 */
export function RouteMapPreview({
  home,
  office,
  className,
}: {
  home: Pt;
  office: Pt;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [visible, setVisible] = useState(false);

  // Lazy: only build tiles once the card is actually on screen.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => {
    if (!size || size.w < 40 || size.h < 40) return null;
    const padX = 64;
    const padY = 72;
    let zoom = 15;
    for (let z = 15; z >= 8; z--) {
      const a = project(home, z);
      const b = project(office, z);
      if (
        Math.abs(a.x - b.x) <= Math.max(40, size.w - padX * 2) &&
        Math.abs(a.y - b.y) <= Math.max(40, size.h - padY * 2)
      ) {
        zoom = z;
        break;
      }
      zoom = z;
    }
    const a = project(home, zoom);
    const b = project(office, zoom);
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const originX = cx - size.w / 2;
    const originY = cy - size.h / 2;

    const tiles: { key: string; x: number; y: number; url: string }[] = [];
    const max = Math.pow(2, zoom);
    const tx0 = Math.floor(originX / TILE);
    const ty0 = Math.floor(originY / TILE);
    const tx1 = Math.floor((originX + size.w) / TILE);
    const ty1 = Math.floor((originY + size.h) / TILE);
    for (let tx = tx0; tx <= tx1; tx++) {
      for (let ty = ty0; ty <= ty1; ty++) {
        if (ty < 0 || ty >= max) continue;
        const wrapped = ((tx % max) + max) % max;
        tiles.push({
          key: `${zoom}/${tx}/${ty}`,
          x: tx * TILE - originX,
          y: ty * TILE - originY,
          url: `https://tile.openstreetmap.org/${zoom}/${wrapped}/${ty}.png`,
        });
      }
    }
    return {
      tiles,
      home: { x: a.x - originX, y: a.y - originY },
      office: { x: b.x - originX, y: b.y - originY },
      w: size.w,
      h: size.h,
    };
  }, [size, home.lat, home.lng, office.lat, office.lng]);

  return (
    <div ref={ref} className={`relative overflow-hidden bg-muted ${className ?? ""}`}>
      {visible && layout ? (
        <>
          {layout.tiles.map((t) => (
            <img
              key={t.key}
              src={t.url}
              alt=""
              aria-hidden="true"
              loading="lazy"
              draggable={false}
              className="pointer-events-none absolute select-none opacity-90"
              style={{ left: t.x, top: t.y, width: TILE, height: TILE }}
            />
          ))}
          <svg
            className="pointer-events-none absolute inset-0"
            width={layout.w}
            height={layout.h}
            aria-hidden="true"
          >
            <line
              x1={layout.home.x}
              y1={layout.home.y}
              x2={layout.office.x}
              y2={layout.office.y}
              stroke="var(--color-primary)"
              strokeWidth={4}
              strokeLinecap="round"
              opacity={0.85}
            />
          </svg>
          <Marker x={layout.home.x} y={layout.home.y} label="Home">
            <Home className="h-3.5 w-3.5" />
          </Marker>
          <Marker x={layout.office.x} y={layout.office.y} label="Studio">
            <Briefcase className="h-3.5 w-3.5" />
          </Marker>
        </>
      ) : null}
      <div className="pointer-events-none absolute inset-0 bg-background/10" />
    </div>
  );
}

function Marker({
  x,
  y,
  label,
  children,
}: {
  x: number;
  y: number;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="absolute grid h-8 w-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg ring-2 ring-background"
      style={{ left: x, top: y }}
      aria-label={label}
      title={label}
    >
      {children}
    </div>
  );
}
