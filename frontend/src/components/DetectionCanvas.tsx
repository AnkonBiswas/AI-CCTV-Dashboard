import { useEffect, useRef } from "react";
import { useDetectionStream } from "@/hooks/useSocket";
import { DETECTION_COLORS, colorForDetection } from "@/lib/colors";
import type { Detection, IncidentDetection } from "@/types/api";

type Props = {
  streamId: string;
  videoEl: HTMLVideoElement | null;
  onIncidentChange?: (active: boolean) => void;
  syncDelayMs?: number;
};

const CLEAR_AFTER_MS = 1000;

export function DetectionCanvas({ streamId, videoEl, onIncidentChange, syncDelayMs = 1200 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const detectionsRef = useRef<Detection[]>([]);
  const incidentsRef = useRef<IncidentDetection[]>([]);
  const lastUpdateRef = useRef(0);
  const lastIncidentUpdateRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const onEvent = useRef((ev: { detections: Detection[]; incidents: IncidentDetection[]; t: number }) => {
    window.setTimeout(() => {
      detectionsRef.current = ev.detections;
      incidentsRef.current = ev.incidents;
      lastUpdateRef.current = Date.now();
      if (ev.incidents && ev.incidents.length > 0) lastIncidentUpdateRef.current = Date.now();
      scheduleDraw();
    }, syncDelayMs);
  });

  function scheduleDraw() {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      draw();
    });
  }

  function draw() {
    const canvas = canvasRef.current;
    const video = videoEl;
    if (!canvas) return;

    if (video) {
      const rect = video.getBoundingClientRect();
      if (rect.width && rect.height) {
        if (canvas.width !== Math.round(rect.width) || canvas.height !== Math.round(rect.height)) {
          canvas.width = Math.round(rect.width);
          canvas.height = Math.round(rect.height);
        }
      }
    }
    if (!canvas.width || !canvas.height) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const now = Date.now();
    const dets = now - lastUpdateRef.current < CLEAR_AFTER_MS * 2 ? detectionsRef.current : [];
    const incs = now - lastIncidentUpdateRef.current < CLEAR_AFTER_MS * 2 ? incidentsRef.current : [];

    for (const d of dets) {
      const x = d.x * canvas.width;
      const y = d.y * canvas.height;
      const w = d.w * canvas.width;
      const h = d.h * canvas.height;
      const color = colorForDetection(d);
      ctx.lineWidth = d.personType === "threat" ? 3 : 1.5;
      ctx.strokeStyle = color;
      ctx.strokeRect(x, y, w, h);

      const tag =
        d.name && d.personType && d.personType !== "standard"
          ? `${d.name} · ${d.personType}`
          : d.name || d.label;
      const label = `${tag} · ${Math.round(d.confidence * 100)}%`;
      drawLabel(ctx, x, y, label, color);
    }

    for (const inc of incs) {
      const [x1, y1, x2, y2] = inc.box;
      const x = x1 * canvas.width;
      const y = y1 * canvas.height;
      const w = (x2 - x1) * canvas.width;
      const h = (y2 - y1) * canvas.height;
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = DETECTION_COLORS.incident;
      ctx.strokeRect(x, y, w, h);
      drawLabel(
        ctx,
        x,
        y,
        `${inc.type} · ${Math.round((inc.confidence || 0) * 100)}%`,
        DETECTION_COLORS.incident,
        20,
      );
    }

    onIncidentChange?.(incs.length > 0);
  }

  useDetectionStream(streamId, (ev) => onEvent.current(ev));

  useEffect(() => {
    function resize() {
      scheduleDraw();
    }
    window.addEventListener("resize", resize);
    let ro: ResizeObserver | null = null;
    if (videoEl && "ResizeObserver" in window) {
      ro = new ResizeObserver(() => scheduleDraw());
      ro.observe(videoEl);
    }
    const sweep = window.setInterval(() => {
      const now = Date.now();
      if (
        (now - lastUpdateRef.current > CLEAR_AFTER_MS && detectionsRef.current.length) ||
        (now - lastIncidentUpdateRef.current > CLEAR_AFTER_MS && incidentsRef.current.length)
      ) {
        if (now - lastUpdateRef.current > CLEAR_AFTER_MS) detectionsRef.current = [];
        if (now - lastIncidentUpdateRef.current > CLEAR_AFTER_MS) incidentsRef.current = [];
        scheduleDraw();
      }
    }, 500);
    return () => {
      window.removeEventListener("resize", resize);
      ro?.disconnect();
      window.clearInterval(sweep);
    };
  }, [videoEl]);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />;
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  color: string,
  height = 18,
) {
  ctx.font = '500 11px Inter, system-ui, sans-serif';
  const padX = 6;
  const tw = ctx.measureText(text).width;
  const ly = Math.max(0, y - height);
  ctx.fillStyle = color;
  ctx.fillRect(x, ly, tw + padX * 2, height);
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + padX, ly + height / 2);
}
