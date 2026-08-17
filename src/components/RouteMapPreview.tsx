import { useEffect, useRef, useState } from "react";
import type * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { getRouteGeometry } from "@/lib/travel.functions";

type Pt = { lat: number; lng: number };

/** 60s cache of resolved route geometries, keyed by coordinate pair. */
const routeCache = new Map<string, { at: number; coords: [number, number][] | null }>();
const CACHE_MS = 60_000;

function key(home: Pt, office: Pt) {
  return `${home.lat.toFixed(5)},${home.lng.toFixed(5)}|${office.lat.toFixed(5)},${office.lng.toFixed(5)}`;
}

async function resolveRoute(home: Pt, office: Pt, signal: AbortSignal) {
  const k = key(home, office);
  const hit = routeCache.get(k);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.coords;
  let coords: [number, number][] | null = null;
  try {
    // Routing runs server-side so the routing provider key never reaches the browser.
    const res = await getRouteGeometry({
      data: {
        from_lat: home.lat,
        from_lng: home.lng,
        to_lat: office.lat,
        to_lng: office.lng,
      },
      signal,
    });
    coords = res?.coords ?? null;
  } catch {
    coords = null;
  }
  routeCache.set(k, { at: Date.now(), coords });
  return coords;
}


function pinIcon(leaflet: typeof L, kind: "home" | "office") {
  const glyph =
    kind === "home"
      ? '<path d="M3 10.5 12 3l9 7.5V21H3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'
      : '<rect x="4" y="7" width="16" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 7V5h6v2" fill="none" stroke="currentColor" stroke-width="2"/>';
  return leaflet.divIcon({
    className: "",
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    html: `<div style="display:grid;place-items:center;width:32px;height:32px;border-radius:9999px;background:var(--color-primary);color:var(--color-primary-foreground);box-shadow:0 4px 12px rgba(0,0,0,.35);outline:2px solid var(--color-background)"><svg viewBox="0 0 24 24" width="16" height="16">${glyph}</svg></div>`,
  });
}

/**
 * Live Leaflet route map (OpenStreetMap tiles + OpenRouteService/OSRM routing).
 * Lazy-loads the map library only once the card scrolls into view.
 */
export function RouteMapPreview({
  home,
  office,
  className,
  geometry,
}: {
  home: Pt;
  office: Pt;
  className?: string;
  /**
   * Route geometry from the persisted travel snapshot. When provided (even as
   * `null`, meaning "the stored plan has no geometry"), the map never calls
   * the routing service itself — the snapshot is the single source of truth.
   */
  geometry?: [number, number][] | null;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.Layer[]>([]);
  const boundsRef = useRef<L.LatLngBounds | null>(null);
  const [visible, setVisible] = useState(false);
  const [routeFailed, setRouteFailed] = useState(false);

  useEffect(() => {
    const el = hostRef.current;
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
    if (!visible) return;
    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      const leaflet = (await import("leaflet")).default;
      const el = hostRef.current;
      if (cancelled || !el) return;

      // Leaflet locks its zoom to the container size at init time; wait for
      // layout so the initial fitBounds isn't computed against a 0x0 box.
      for (let i = 0; i < 30 && el.clientHeight < 20; i++) {
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        if (cancelled) return;
      }

      if (!mapRef.current) {
        mapRef.current = leaflet.map(el, {
          zoomControl: false,
          attributionControl: false,
          dragging: false,
          scrollWheelZoom: false,
          doubleClickZoom: false,
          boxZoom: false,
          keyboard: false,
          touchZoom: false,

        } as L.MapOptions);
        const dark =
          typeof document !== "undefined" &&
          document.documentElement.classList.contains("dark");
        leaflet
          .tileLayer(
            dark
              ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
            { maxZoom: 19, subdomains: "abcd" },
          )
          .addTo(mapRef.current);
      }

      const map = mapRef.current;
      for (const layer of layersRef.current) map.removeLayer(layer);
      layersRef.current = [];

      const homeMarker = leaflet
        .marker([home.lat, home.lng], { icon: pinIcon(leaflet, "home"), interactive: false })
        .addTo(map);
      const officeMarker = leaflet
        .marker([office.lat, office.lng], { icon: pinIcon(leaflet, "office"), interactive: false })
        .addTo(map);
      layersRef.current.push(homeMarker, officeMarker);

      const straight: [number, number][] = [
        [home.lat, home.lng],
        [office.lat, office.lng],
      ];
      const fit = (coords: [number, number][]) => {
        const bounds = leaflet.latLngBounds(coords);
        boundsRef.current = bounds;
        map.invalidateSize();
        map.fitBounds(bounds, { padding: [56, 72] });
        // Re-frame once more after the browser has settled the layout.
        requestAnimationFrame(() => {
          if (cancelled || !mapRef.current) return;
          mapRef.current.invalidateSize();
          mapRef.current.fitBounds(bounds, { padding: [56, 72] });
        });
      };


      const provisional = leaflet
        .polyline(straight, {
          color: "var(--color-primary)",
          weight: 4,
          opacity: 0.55,
          dashArray: "6 8",
          interactive: false,
        })
        .addTo(map);
      layersRef.current.push(provisional);
      fit(straight);

      const coords = await resolveRoute(home, office, controller.signal);
      if (cancelled) return;
      setRouteFailed(!coords);
      if (coords) {
        map.removeLayer(provisional);
        layersRef.current = layersRef.current.filter((l) => l !== provisional);
        const line = leaflet
          .polyline(coords, {
            color: "var(--color-primary)",
            weight: 4,
            opacity: 0.9,
            lineCap: "round",
            interactive: false,
          })
          .addTo(map);
        layersRef.current.push(line);
        fit(coords);
      }
    })().catch(() => setRouteFailed(true));

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [visible, home.lat, home.lng, office.lat, office.lng]);

  // Keep the map filling its container (and framed) on every layout change.
  useEffect(() => {
    const el = hostRef.current;
    if (!visible || !el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const map = mapRef.current;
      if (!map) return;
      map.invalidateSize();
      if (boundsRef.current) map.fitBounds(boundsRef.current, { padding: [56, 72] });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [visible]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div className={`overflow-hidden bg-muted ${className ?? "relative h-full w-full"}`}>
      <div ref={hostRef} className="absolute inset-0 h-full w-full" />
      {routeFailed ? (
        <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-border bg-background/90 px-2 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
          Route unavailable.
        </div>
      ) : null}
    </div>
  );
}
