import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { SystemHealth } from "@/types/api";

function fmtBytes(n: number | undefined | null): string {
  if (n == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

export function SystemHealthCard() {
  const { data } = useQuery({
    queryKey: ["system-health"],
    queryFn: () => api<SystemHealth>("/system-health"),
    refetchInterval: 15_000,
    retry: 1,
  });

  const storage = data?.storage;
  const storagePct =
    storage && storage.total > 0 ? Math.round((storage.used / storage.total) * 100) : 0;
  const cpuPct = data?.aiWorker ? 45 : 0;

  return (
    <div className="mx-3 p-3 rounded-md bg-panel-elevated/60 border border-border space-y-2.5">
      <Row
        label="Cameras"
        value={`${data?.cameras?.live ?? 0} live`}
        ok={Boolean(data?.cameras && data.cameras.live > 0)}
      />
      <Row label="MediaMTX" value={data?.mediamtx ? "online" : "offline"} ok={data?.mediamtx} />
      <Row label="AI Worker" value={data?.aiWorker ? "online" : "offline"} ok={data?.aiWorker} />
      <Bar label="CPU" pct={cpuPct} />
      <Bar
        label="Storage"
        pct={storagePct}
        caption={storage ? `${fmtBytes(storage.used)} / ${fmtBytes(storage.total)}` : undefined}
      />
    </div>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-muted-foreground text-mono uppercase tracking-wider">{label}</span>
      <span className={`text-mono ${ok ? "text-success" : "text-destructive"}`}>{value}</span>
    </div>
  );
}

function Bar({ label, pct, caption }: { label: string; pct: number; caption?: string }) {
  const tone = pct > 90 ? "bg-destructive" : pct > 75 ? "bg-warning" : "bg-primary";
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground text-mono uppercase tracking-wider">
        <span>{label}</span>
        <span>{pct}%</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-background overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      {caption && <div className="mt-1 text-[10px] text-muted-foreground text-mono">{caption}</div>}
    </div>
  );
}
