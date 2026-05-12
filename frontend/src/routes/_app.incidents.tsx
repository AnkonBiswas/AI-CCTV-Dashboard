import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, X } from "lucide-react";
import { StatCard } from "@/components/AppShell";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { buildAssetUrl } from "@/lib/api";
import { useIncidents } from "@/hooks/queries";
import type { Incident } from "@/types/api";

export const Route = createFileRoute("/_app/incidents")({
  staticData: { title: "Incidents", subtitle: "Fire, smoke, and named-face events" },
  component: IncidentsPage,
});

type Filter = "all" | "alerts" | "fire" | "smoke" | "face" | "person";

function IncidentsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const params = useMemo(() => {
    if (filter === "alerts") return { incidentsOnly: true, limit: 200 };
    if (filter === "all") return { limit: 200 };
    return { type: filter, limit: 200 };
  }, [filter]);
  const q = useIncidents({ ...params, refetchInterval: 15_000 });

  const rows = q.data ?? [];
  const counts = useMemo(() => {
    let alerts = 0,
      faces = 0,
      persons = 0;
    for (const r of rows) {
      if (r.type === "fire" || r.type === "smoke") alerts += 1;
      else if (r.type === "face") faces += 1;
      else if (r.type === "person") persons += 1;
    }
    return { alerts, faces, persons };
  }, [rows]);

  const [lightbox, setLightbox] = useState<Incident | null>(null);

  return (
    <div className="p-8 space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total events" value={String(rows.length)} />
        <StatCard
          label="Alerts"
          value={String(counts.alerts)}
          tone={counts.alerts > 0 ? "destructive" : "default"}
        />
        <StatCard label="Face matches" value={String(counts.faces)} />
        <StatCard label="People" value={String(counts.persons)} />
      </div>

      <div className="bg-panel border border-border rounded-xl">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="text-sm font-semibold">Event log</div>
          <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="alerts">Fire / smoke only</SelectItem>
              <SelectItem value="fire">Fire</SelectItem>
              <SelectItem value="smoke">Smoke</SelectItem>
              <SelectItem value="face">Face</SelectItem>
              <SelectItem value="person">Person</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-widest text-mono text-muted-foreground border-b border-border">
              <th className="px-5 py-3 font-medium">Snapshot</th>
              <th className="px-5 py-3 font-medium">Type</th>
              <th className="px-5 py-3 font-medium">Camera</th>
              <th className="px-5 py-3 font-medium">Subject</th>
              <th className="px-5 py-3 font-medium">Confidence</th>
              <th className="px-5 py-3 font-medium">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center">
                  <div className="text-xs text-muted-foreground">No events match this filter.</div>
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const alert = r.type === "fire" || r.type === "smoke";
              return (
                <tr key={r.id} className="hover:bg-panel-elevated transition">
                  <td className="px-5 py-3">
                    {r.snapshot ? (
                      <button
                        onClick={() => setLightbox(r)}
                        className="block size-12 rounded overflow-hidden border border-border"
                      >
                        <img
                          src={buildAssetUrl(`/snapshot/${r.streamId}/${r.snapshot}`)}
                          alt=""
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = "none";
                          }}
                        />
                      </button>
                    ) : (
                      <div className="size-12 rounded bg-panel-elevated border border-border" />
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 text-[10px] text-mono uppercase px-2 py-0.5 rounded-full border ${
                        alert
                          ? "bg-destructive/15 text-destructive border-destructive/30"
                          : "bg-primary/15 text-primary border-primary/30"
                      }`}
                    >
                      {alert && <AlertTriangle className="size-3" />} {r.type}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-mono text-xs">{r.cameraName}</td>
                  <td className="px-5 py-3 text-xs">{r.name ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-5 py-3 text-mono text-xs text-muted-foreground">
                    {Math.round((r.confidence || 0) * 100)}%
                  </td>
                  <td className="px-5 py-3 text-mono text-xs text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-background/90 backdrop-blur grid place-items-center p-8"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 size-9 rounded-md bg-panel border border-border grid place-items-center"
            onClick={() => setLightbox(null)}
          >
            <X className="size-4" />
          </button>
          <div className="max-w-5xl w-full" onClick={(e) => e.stopPropagation()}>
            <img
              src={buildAssetUrl(`/snapshot/${lightbox.streamId}/${lightbox.snapshot}`)}
              alt=""
              className="w-full max-h-[80vh] object-contain rounded-lg border border-border"
            />
            <div className="mt-3 text-xs text-mono text-muted-foreground text-center">
              {lightbox.cameraName} · {lightbox.type} · {new Date(lightbox.createdAt).toLocaleString()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
