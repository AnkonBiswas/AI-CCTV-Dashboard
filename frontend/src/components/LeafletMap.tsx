import { useEffect, useRef } from "react";
import type {
  Map as LeafletMapInstance,
  Marker as LeafletMarker,
  Polyline as LeafletPolyline,
  LatLngBoundsLiteral,
} from "leaflet";

type MarkerInput = {
  id: string;
  lat: number;
  lng: number;
  popup?: string;
};

type PathStop = {
  lat: number;
  lng: number;
  popup?: string;
};

type Props =
  | { mode: "markers"; markers: MarkerInput[]; className?: string }
  | { mode: "path"; stops: PathStop[]; className?: string };

const TILE_URL = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

export function LeafletMap(props: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMapInstance | null>(null);
  const layerRefs = useRef<(LeafletMarker | LeafletPolyline)[]>([]);
  const lRef = useRef<typeof import("leaflet") | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const L = await import("leaflet");
      await import("leaflet/dist/leaflet.css");
      if (cancelled || !containerRef.current) return;
      lRef.current = L;
      const map = L.map(containerRef.current, { zoomControl: true, worldCopyJump: true }).setView(
        [0, 0],
        2,
      );
      L.tileLayer(TILE_URL, { attribution: TILE_ATTR, subdomains: "abcd", maxZoom: 19 }).addTo(map);
      mapRef.current = map;
      render();
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      layerRefs.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(props)]);

  function render() {
    const L = lRef.current;
    const map = mapRef.current;
    if (!L || !map) return;

    for (const layer of layerRefs.current) {
      try {
        map.removeLayer(layer);
      } catch {
        /* ignore */
      }
    }
    layerRefs.current = [];

    if (props.mode === "markers") {
      if (!props.markers.length) {
        map.setView([0, 0], 2);
        return;
      }
      const bounds: LatLngBoundsLiteral = [];
      for (const m of props.markers) {
        const marker = L.marker([m.lat, m.lng]);
        if (m.popup) marker.bindPopup(m.popup);
        marker.addTo(map);
        layerRefs.current.push(marker);
        bounds.push([m.lat, m.lng]);
      }
      if (bounds.length === 1) map.setView(bounds[0], 15);
      else map.fitBounds(bounds, { padding: [30, 30] });
    } else {
      if (!props.stops.length) {
        map.setView([0, 0], 2);
        return;
      }
      const latlngs = props.stops.map((s) => [s.lat, s.lng] as [number, number]);
      const line = L.polyline(latlngs, { color: "#6366f1", weight: 3, dashArray: "6 6" });
      line.addTo(map);
      layerRefs.current.push(line);
      props.stops.forEach((s, idx) => {
        const isStart = idx === 0;
        const isEnd = idx === props.stops.length - 1;
        const colour = isStart ? "#10b981" : isEnd ? "#ef4444" : "#3b82f6";
        const icon = L.divIcon({
          html: `<div style="background:${colour};color:#fff;border-radius:9999px;width:22px;height:22px;display:grid;place-items:center;font:600 11px Inter, system-ui;border:2px solid #0c111b;">${idx + 1}</div>`,
          className: "",
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });
        const marker = L.marker([s.lat, s.lng], { icon });
        if (s.popup) marker.bindPopup(s.popup);
        marker.addTo(map);
        layerRefs.current.push(marker);
      });
      map.fitBounds(latlngs, { padding: [40, 40] });
    }
    window.setTimeout(() => map.invalidateSize(), 200);
  }

  return (
    <div
      ref={containerRef}
      className={props.className ?? "h-[420px] w-full rounded-xl border border-border bg-panel"}
    />
  );
}
