import { useEffect, useRef, useState } from "react";
import type * as L from "leaflet";

type Pt = { lat: number; lng: number };

const ORS_KEY = import.meta.env["VITE_ORS_API_KEY"] as string | undefined;

/** 60s cache of resolved route geometries, keyed by coordinate pair. */
const routeCache = new Map<string, { at: number; coords: [number, number][] | null }>();
const CACHE_MS = 60_000;

function key(home: Pt, office: Pt) {
  return `${home.lat.toFixed(5)},${home.lng.toFixed(5)}|${office.lat.toFixed(5)},${office.lng.toFixed(5)}`;
}

async function fetchOrs(home: Pt, office: Pt, signal: AbortSignal) {
  if (!ORS_KEY) return null;
  const res = await fetch(
    "https://api.openrouteservice.org/v2/directions/driving-car/geojson",
    {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", Authorization: ORS_KEY },
      body: JSON.stringify({
        coordinates: [
          [home.lng, home.lat],
          [office.lng, office.lat],
        ],
      }),
    },
  );
  if (!res.ok) return null;
  const json = (await res.json()) as {
    features?: { geometry?: { coordinates?: [number, number][] } }[];
  };
  const line = json.features?.[0]?.geometry?.coordinates;
  if (!line?.length) return null;
  return line.map(([lng, lat]) => [lat, lng] as [number, number]);
}

async function fetchOsrm(home: Pt, office: Pt, signal: AbortSignal) {
  const url = `https://router.project-osrm.org/route/v1/driving/${home.lng},${home.lat};${office.lng},${office.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    routes?: { geometry?: { coordinates?: [number, number][] } }[];
  };
  const line = json.routes?.[0]?.geometry?.coordinates;
  if (!line?.length) return null;
  return line.map(([lng, lat]) => [lat, lng] as [number, number]);
}

async function resolveRoute(home: Pt, office: Pt, signal: AbortSignal) {
  const k = key(home, office);
  const hit = routeCache.get(k);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.coords;
  let coords: [number, number][] | null = null;
  try {
    coords = await fetchOrs(home, office, signal);
  } catch {
    coords = null;
  }
  if (!coords) {
    try {
      coords = await fetchOsrm(home, office, signal);
    } catch {
      coords = null;
    }
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
}: {
  home: Pt;
  office: Pt;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.Layer[]>([]);
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
      await import("leaflet/dist/leaflet.css");
      const el = hostRef.current;
      if (cancelled || !el) return;

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
2,
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
        map.fitBounds(leaflet.latLngBounds(coords), { padding: [56, 72] });
        setTimeout(() => map.invalidateSize(), 0);
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

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div className={`relative overflow-hidden bg-muted ${className ?? ""}`}>
      <div ref={hostRef} className="absolute inset-0 h-full w-full" />
      {routeFailed ? (
        <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-border bg-background/90 px-2 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
          Route unavailable.
        </div>
      ) : null}
    </div>
  );
}
