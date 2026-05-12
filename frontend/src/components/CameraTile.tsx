import { useEffect, useRef, useState } from "react";
import { Maximize2, MoreVertical, Camera as CameraIcon, Circle, Trash2, Square } from "lucide-react";
import { attachHls, probeManifest, type HlsHandle } from "@/lib/hls-player";
import { attachWebRtc, type WebRtcHandle } from "@/lib/webrtc-player";
import { DetectionCanvas } from "@/components/DetectionCanvas";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Props = {
  streamId: string;
  cameraName: string;
  hlsUrl: string;
  pathName: string;
  onRemove?: () => void;
  showRemove?: boolean;
  variant?: "primary" | "tile";
};

type Status = "connecting" | "live" | "offline";
type Transport = "webrtc" | "hls" | null;

export function CameraTile({
  streamId,
  cameraName,
  hlsUrl,
  pathName,
  onRemove,
  showRemove = true,
  variant = "tile",
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const webrtcRef = useRef<WebRtcHandle | null>(null);
  const hlsRef = useRef<HlsHandle | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const promoteTimer = useRef<number | null>(null);
  const removedRef = useRef(false);
  const [status, setStatus] = useState<Status>("connecting");
  const [transport, setTransport] = useState<Transport>(null);
  const [latency, setLatency] = useState<string>("");
  const [incidentActive, setIncidentActive] = useState(false);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordChunks = useRef<Blob[]>([]);

  function teardown() {
    if (webrtcRef.current) {
      webrtcRef.current.destroy();
      webrtcRef.current = null;
    }
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }

  function scheduleReconnect(delay = 5000) {
    if (removedRef.current) return;
    if (reconnectTimer.current != null) window.clearTimeout(reconnectTimer.current);
    reconnectTimer.current = window.setTimeout(() => {
      reconnectTimer.current = null;
      void start();
    }, delay);
  }

  function schedulePromote() {
    if (removedRef.current) return;
    if (promoteTimer.current != null) window.clearTimeout(promoteTimer.current);
    promoteTimer.current = window.setTimeout(async () => {
      promoteTimer.current = null;
      if (removedRef.current || transport !== "hls") return;
      const video = videoRef.current;
      if (!video) return;
      try {
        const handle = await attachWebRtc(video, pathName, () => scheduleReconnect(1000));
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
        webrtcRef.current = handle;
        setTransport("webrtc");
      } catch {
        schedulePromote();
      }
    }, 8000);
  }

  async function start() {
    if (removedRef.current) return;
    teardown();
    setTransport(null);
    setStatus("connecting");
    const video = videoRef.current;
    if (!video) return;

    if (window.RTCPeerConnection && pathName) {
      try {
        const handle = await attachWebRtc(video, pathName, () => scheduleReconnect(1000));
        webrtcRef.current = handle;
        setTransport("webrtc");
        setStatus("live");
        return;
      } catch {
        if (webrtcRef.current) {
          webrtcRef.current.destroy();
          webrtcRef.current = null;
        }
      }
    }

    if (await probeManifest(hlsUrl)) {
      const handle = attachHls(video, hlsUrl, { onFatal: () => scheduleReconnect(2000) });
      hlsRef.current = handle;
      setTransport("hls");
      setStatus("live");
      schedulePromote();
      return;
    }

    setStatus("offline");
    scheduleReconnect(5000);
  }

  useEffect(() => {
    removedRef.current = false;
    void start();
    return () => {
      removedRef.current = true;
      if (reconnectTimer.current != null) window.clearTimeout(reconnectTimer.current);
      if (promoteTimer.current != null) window.clearTimeout(promoteTimer.current);
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamId, hlsUrl, pathName]);

  useEffect(() => {
    if (status !== "live") {
      setLatency("");
      return;
    }
    const interval = window.setInterval(async () => {
      if (transport === "webrtc" && webrtcRef.current) {
        const rtt = await webrtcRef.current.rtt();
        if (rtt == null) setLatency("RTC · —");
        else setLatency(`RTC · ${Math.round(rtt * 1000)} ms`);
      } else if (transport === "hls" && hlsRef.current) {
        const s = hlsRef.current.latency();
        if (s == null) setLatency("");
        else if (s < 1) setLatency(`HLS · ${Math.round(s * 1000)} ms`);
        else setLatency(`HLS · ${s.toFixed(1)} s`);
      }
    }, 2000);
    return () => window.clearInterval(interval);
  }, [status, transport]);

  function screenshot() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${cameraName}_${ts}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }

  function toggleRecord() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    const stream =
      (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.() ?? null;
    if (!stream) return;
    const mr = new MediaRecorder(stream, { mimeType: "video/webm" });
    recordChunks.current = [];
    mr.ondataavailable = (e) => {
      if (e.data.size) recordChunks.current.push(e.data);
    };
    mr.onstop = () => {
      const blob = new Blob(recordChunks.current, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${cameraName}_${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
      a.click();
      URL.revokeObjectURL(url);
      setRecording(false);
    };
    mr.start(1000);
    recorderRef.current = mr;
    setRecording(true);
  }

  function fullscreen() {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) {
      void document.exitFullscreen();
    } else {
      void el.requestFullscreen();
    }
  }

  const statusBg =
    status === "live" ? "bg-success" : status === "connecting" ? "bg-warning" : "bg-muted-foreground";
  const statusLabel =
    status === "live" ? "Live" : status === "connecting" ? "Connecting" : "Offline";

  return (
    <div
      ref={wrapRef}
      className={`relative rounded-xl overflow-hidden border bg-panel group ${
        incidentActive ? "border-destructive shadow-[0_0_24px_color-mix(in_oklab,var(--destructive)_35%,transparent)]" : "border-border"
      }`}
    >
      <video
        ref={videoRef}
        className="w-full aspect-video object-cover bg-black"
        autoPlay
        muted
        playsInline
      />
      <DetectionCanvas
        streamId={streamId}
        videoEl={videoRef.current}
        onIncidentChange={setIncidentActive}
      />

      <div className="absolute top-3 left-3 right-3 flex items-start justify-between pointer-events-none">
        <div className="flex flex-wrap gap-1.5">
          <span className="px-1.5 py-0.5 text-[9px] text-mono font-semibold bg-background/70 backdrop-blur rounded border border-border">
            {cameraName}
          </span>
          {variant === "primary" && transport && (
            <span className="px-1.5 py-0.5 text-[9px] text-mono font-semibold bg-primary/15 text-primary rounded border border-primary/30 uppercase">
              {transport}
            </span>
          )}
        </div>
        <div className="flex gap-1.5 pointer-events-auto">
          <button
            onClick={fullscreen}
            className="size-7 rounded-md bg-background/70 backdrop-blur border border-border grid place-items-center hover:bg-panel-elevated"
            title="Fullscreen"
          >
            <Maximize2 className="size-3" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="size-7 rounded-md bg-background/70 backdrop-blur border border-border grid place-items-center hover:bg-panel-elevated"
                title="More"
              >
                <MoreVertical className="size-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={screenshot}>
                <CameraIcon className="size-3.5" /> Screenshot
              </DropdownMenuItem>
              <DropdownMenuItem onClick={toggleRecord}>
                {recording ? (
                  <>
                    <Square className="size-3.5" /> Stop recording
                  </>
                ) : (
                  <>
                    <Circle className="size-3.5" /> Record
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={fullscreen}>
                <Maximize2 className="size-3.5" /> Fullscreen
              </DropdownMenuItem>
              {showRemove && onRemove && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={onRemove}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="size-3.5" /> Remove camera
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between pointer-events-none">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-mono text-muted-foreground">
            {transport ? transport.toUpperCase() : ""}
          </div>
          <div className="text-sm font-semibold">{cameraName}</div>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-mono">
          {latency && <span className="text-muted-foreground">{latency}</span>}
          <span className={`size-1.5 rounded-full animate-pulse ${statusBg}`} /> {statusLabel}
        </div>
      </div>

      {recording && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 text-[10px] text-mono bg-destructive/15 text-destructive border border-destructive/30 rounded-full px-2 py-0.5">
          <span className="size-1.5 rounded-full bg-destructive animate-pulse" /> REC
        </div>
      )}
    </div>
  );
}
