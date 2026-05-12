import { useState } from "react";
import { createFileRoute, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Avatar, StatCard } from "@/components/AppShell";
import { LeafletMap } from "@/components/LeafletMap";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { buildAssetUrl } from "@/lib/api";
import { usePersonActivity } from "@/hooks/queries";

export const Route = createFileRoute("/_app/person/$name")({
  staticData: { title: "Person Activity", subtitle: "Detection history and movement" },
  component: PersonActivityPage,
});

const RANGES = ["7", "14", "30", "90"] as const;

function PersonActivityPage() {
  const { name } = useParams({ from: "/_app/person/$name" });
  const [days, setDays] = useState<(typeof RANGES)[number]>("30");
  const q = usePersonActivity(name, { days: Number(days) });

  const stops =
    (q.data?.timeline ?? [])
      .filter((t) => t.lat != null && t.lng != null)
      .map((t) => ({
        lat: Number(t.lat),
        lng: Number(t.lng),
        popup: `${escapeHtml(t.cameraName)}<br/><span style="font-family:JetBrains Mono,monospace;font-size:11px">${new Date(t.createdAt).toLocaleString()}</span>`,
      })) ?? [];

  const byHour = q.data?.byHour ?? new Array(24).fill(0);
  const maxHour = Math.max(1, ...byHour);

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center gap-3 text-xs">
        <Link to="/people" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="size-3.5" /> People
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="text-mono">{q.data?.displayName ?? name}</span>
      </div>

      <div className="flex items-center justify-between gap-4 bg-panel border border-border rounded-xl p-5">
        <div className="flex items-center gap-4 min-w-0">
          <Avatar
            initials={(name[0] || "?").toUpperCase()}
            color="oklch(0.7 0.15 200)"
            size={64}
          />
          <div className="min-w-0">
            <div className="text-xl font-semibold truncate">{q.data?.displayName ?? name}</div>
            <div className="text-xs text-muted-foreground text-mono uppercase">{q.data?.type}</div>
            {q.data?.notes && (
              <div className="text-xs text-muted-foreground mt-1 max-w-xl">{q.data.notes}</div>
            )}
          </div>
        </div>
        <Select value={days} onValueChange={(v) => setDays(v as (typeof RANGES)[number])}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RANGES.map((r) => (
              <SelectItem key={r} value={r}>
                {r} days
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total detections" value={String(q.data?.summary.total ?? 0)} />
        <StatCard label="Cameras seen" value={String(q.data?.summary.distinctCameras ?? 0)} />
        <StatCard label="Active days" value={String(q.data?.summary.distinctDays ?? 0)} />
        <StatCard
          label="Last seen"
          value={
            q.data?.summary.lastSeen
              ? new Date(q.data.summary.lastSeen).toLocaleString()
              : "—"
          }
        />
      </div>

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 xl:col-span-8 bg-panel border border-border rounded-xl p-5">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground text-mono">
            Hourly activity
          </div>
          <div className="mt-4 flex gap-1 h-32">
            {byHour.map((v: number, h: number) => (
              <div key={h} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex-1 flex items-end">
                  <div
                    className="w-full rounded-t-sm bg-primary/70"
                    style={{ height: `${(v / maxHour) * 100}%` }}
                    title={`${v} at ${String(h).padStart(2, "0")}:00`}
                  />
                </div>
                {h % 2 === 0 && (
                  <div className="text-[9px] text-mono text-muted-foreground">
                    {String(h).padStart(2, "0")}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="col-span-12 xl:col-span-4 bg-panel border border-border rounded-xl p-5">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground text-mono">
            Top cameras
          </div>
          <div className="mt-4 space-y-2">
            {(q.data?.byCamera ?? []).length === 0 && (
              <div className="text-xs text-muted-foreground text-mono">No data</div>
            )}
            {(q.data?.byCamera ?? []).map((c) => {
              const max = Math.max(...(q.data?.byCamera ?? [{ n: 1 }]).map((x) => x.n), 1);
              return (
                <div key={c.camera} className="flex items-center gap-3">
                  <div className="w-32 text-xs truncate">{c.camera}</div>
                  <div className="flex-1 h-2 rounded-full bg-panel-elevated overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${(c.n / max) * 100}%` }} />
                  </div>
                  <div className="text-[11px] text-mono text-muted-foreground w-8 text-right">
                    {c.n}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 xl:col-span-7 bg-panel border border-border rounded-xl p-1">
          <div className="px-3 py-2 text-[10px] uppercase tracking-widest text-mono text-muted-foreground">
            Movement path
          </div>
          {stops.length === 0 ? (
            <div className="h-[400px] grid place-items-center text-xs text-muted-foreground">
              No geocoded detections in this period.
            </div>
          ) : (
            <LeafletMap mode="path" stops={stops} className="h-[400px] rounded-md" />
          )}
        </div>

        <div className="col-span-12 xl:col-span-5 bg-panel border border-border rounded-xl">
          <div className="p-4 border-b border-border text-[10px] uppercase tracking-widest text-mono text-muted-foreground">
            Recent timeline
          </div>
          <div className="max-h-[400px] overflow-y-auto divide-y divide-border">
            {(q.data?.timeline ?? []).slice(0, 40).map((t) => (
              <div key={t.id} className="px-4 py-3 flex gap-3">
                {t.snapshot ? (
                  <img
                    src={buildAssetUrl(`/snapshot/${t.snapshot}`)}
                    alt=""
                    className="size-12 rounded border border-border object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <div className="size-12 rounded bg-panel-elevated border border-border shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-mono">{t.cameraName}</div>
                  <div className="text-[10px] text-mono text-muted-foreground">
                    {new Date(t.createdAt).toLocaleString()}
                  </div>
                </div>
                <div className="text-[11px] text-mono text-muted-foreground">
                  {Math.round((t.confidence || 0) * 100)}%
                </div>
              </div>
            ))}
            {(q.data?.timeline ?? []).length === 0 && (
              <div className="p-6 text-xs text-muted-foreground text-center">
                No timeline entries
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
