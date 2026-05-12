import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, AlertTriangle, CheckCircle2, Video } from "lucide-react";
import { Avatar, EmptyHint, StatCard } from "@/components/AppShell";
import { CameraTile } from "@/components/CameraTile";
import {
  useAnalytics,
  useAnalyticsCharts,
  useAnalyticsDaywise,
  useCameras,
  useIncidents,
} from "@/hooks/queries";

export const Route = createFileRoute("/_app/")({
  staticData: { title: "Live Operations Center", subtitle: "Real-time surveillance overview" },
  component: Dashboard,
});

function Dashboard() {
  const cameras = useCameras();
  const analytics = useAnalytics("today");
  const charts = useAnalyticsCharts(1);
  const daywise = useAnalyticsDaywise(7);
  const recent = useIncidents({ limit: 8, incidentsOnly: false, refetchInterval: 15_000 });

  const cams = cameras.data ?? [];
  const primary = cams[0];
  const others = cams.slice(1, 4);

  const flux = (charts.data?.heatmap ?? []).reduce<Record<number, number>>((acc, h) => {
    acc[h.hour] = (acc[h.hour] || 0) + h.n;
    return acc;
  }, {});
  const hours = Object.keys(flux)
    .map(Number)
    .sort((a, b) => a - b);
  const maxFlux = Math.max(1, ...Object.values(flux));

  const week = (daywise.data?.rows ?? []).reduce<Record<string, Set<string>>>((acc, r) => {
    if (!acc[r.day]) acc[r.day] = new Set();
    acc[r.day].add(r.nameKey);
    return acc;
  }, {});
  const weekDays = Object.keys(week).sort();

  return (
    <div className="p-8 space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="People Today"
          value={String(analytics.data?.counts.people ?? 0)}
          delta={analytics.data ? `${formatDelta(analytics.data.deltas.people)} vs prior` : undefined}
        />
        <StatCard
          label="Recognized"
          value={String(analytics.data?.counts.recognized ?? 0)}
          delta={
            analytics.data ? `${formatDelta(analytics.data.deltas.recognized)} vs prior` : undefined
          }
          tone="success"
        />
        <StatCard
          label="Events"
          value={String(analytics.data?.counts.events ?? 0)}
          delta={analytics.data ? `${formatDelta(analytics.data.deltas.events)} vs prior` : undefined}
        />
        <StatCard
          label="Alerts"
          value={String(analytics.data?.counts.alerts ?? 0)}
          delta={analytics.data ? `${formatDelta(analytics.data.deltas.alerts)} vs prior` : undefined}
          tone={(analytics.data?.counts.alerts ?? 0) > 0 ? "destructive" : "default"}
        />
      </div>

      <div className="grid grid-cols-12 gap-6">
        <section className="col-span-12 xl:col-span-8 space-y-6">
          {primary ? (
            <CameraTile
              streamId={primary.streamId}
              cameraName={primary.cameraName}
              hlsUrl={primary.hlsUrl}
              pathName={primary.pathName}
              showRemove={false}
              variant="primary"
            />
          ) : (
            <div className="rounded-xl border border-border bg-panel p-10">
              <EmptyHint
                icon={Video}
                title="No cameras yet"
                description="Add a camera from the Cameras page to start monitoring."
              />
            </div>
          )}

          {others.length > 0 && (
            <div className="grid grid-cols-3 gap-4">
              {others.map((c) => (
                <CameraTile
                  key={c.streamId}
                  streamId={c.streamId}
                  cameraName={c.cameraName}
                  hlsUrl={c.hlsUrl}
                  pathName={c.pathName}
                  showRemove={false}
                />
              ))}
            </div>
          )}

          <div className="grid grid-cols-3 gap-6">
            <div className="col-span-2 bg-panel border border-border rounded-xl p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground text-mono">
                    Hourly Detection Flux
                  </div>
                  <div className="mt-1 text-sm font-semibold">
                    Today's people movement across all cameras
                  </div>
                </div>
                <Link to="/attendance" className="text-xs text-primary flex items-center gap-1 hover:underline">
                  Full report <ArrowUpRight className="size-3" />
                </Link>
              </div>
              <div className="mt-6 flex gap-2 h-32">
                {hours.length === 0 ? (
                  <div className="text-xs text-muted-foreground text-mono w-full text-center pt-10">
                    No detections in the last 24h.
                  </div>
                ) : (
                  hours.map((h) => (
                    <div key={h} className="flex-1 flex flex-col items-center gap-2">
                      <div className="w-full flex-1 flex items-end">
                        <div
                          className="w-full rounded-t-sm bg-gradient-to-t from-primary/30 to-primary/80"
                          style={{ height: `${(flux[h] / maxFlux) * 100}%` }}
                        />
                      </div>
                      <div className="text-[10px] text-mono text-muted-foreground">
                        {String(h).padStart(2, "0")}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <Link
              to="/heatmap"
              className="bg-panel border border-border rounded-xl overflow-hidden relative group hover:border-primary/40 transition flex items-end p-5"
            >
              <div>
                <div className="text-[10px] uppercase tracking-widest text-mono text-primary">
                  Heatmap
                </div>
                <div className="text-sm font-semibold mt-1 flex items-center justify-between">
                  Density Hotspots
                  <ArrowUpRight className="size-3.5 group-hover:translate-x-0.5 transition" />
                </div>
              </div>
            </Link>
          </div>
        </section>

        <aside className="col-span-12 xl:col-span-4 space-y-6">
          <div className="bg-panel border border-border rounded-xl p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground text-mono">
                  Attendance · This Week
                </div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">
                  {weekDays.reduce((acc, d) => acc + week[d].size, 0)}
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-success text-xs text-mono">
                <CheckCircle2 className="size-3.5" /> ROLLING 7D
              </div>
            </div>
            <div className="mt-5 flex gap-2 h-24">
              {weekDays.length === 0 ? (
                <div className="text-xs text-muted-foreground text-mono w-full text-center pt-6">
                  No data yet
                </div>
              ) : (
                weekDays.map((d) => {
                  const max = Math.max(...weekDays.map((dd) => week[dd].size), 1);
                  const pct = (week[d].size / max) * 100;
                  return (
                    <div key={d} className="flex-1 flex flex-col items-center gap-1.5">
                      <div className="w-full flex-1 flex items-end">
                        <div
                          className="w-full rounded-t-sm bg-primary/70"
                          style={{ height: `${pct}%` }}
                        />
                      </div>
                      <div className="text-[9px] text-mono text-muted-foreground uppercase">
                        {d.slice(5)}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="bg-panel border border-border rounded-xl flex flex-col max-h-[560px]">
            <div className="p-5 border-b border-border flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground text-mono">
                  Identification Stream
                </div>
                <div className="mt-1 text-sm font-semibold">Live face matches</div>
              </div>
              <span className="text-[10px] text-mono text-primary flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-primary animate-pulse" /> LIVE
              </span>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-border">
              {(recent.data ?? []).length === 0 && (
                <div className="p-6 text-xs text-muted-foreground text-mono text-center">
                  No identifications yet.
                </div>
              )}
              {(recent.data ?? []).map((row) => {
                if (!row.name || row.type === "fire" || row.type === "smoke") {
                  return (
                    <div
                      key={row.id}
                      className="px-5 py-3 flex items-center gap-3 bg-warning/5 hover:bg-warning/10 transition"
                    >
                      <div className="size-10 rounded-md bg-warning/15 border border-warning/30 grid place-items-center">
                        <AlertTriangle className="size-4 text-warning" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-warning">
                          {row.type === "fire" || row.type === "smoke"
                            ? `${row.type.toUpperCase()} detected`
                            : "Unknown Subject"}
                        </div>
                        <div className="text-[10px] text-mono text-muted-foreground">
                          {row.cameraName} · {new Date(row.createdAt).toLocaleTimeString()}
                        </div>
                      </div>
                      <span className="text-[10px] font-bold text-warning text-mono">ALERT</span>
                    </div>
                  );
                }
                const initials = (row.name[0] || "?").toUpperCase();
                return (
                  <Link
                    key={row.id}
                    to="/person/$name"
                    params={{ name: row.name }}
                    className="px-5 py-3 flex items-center gap-3 hover:bg-panel-elevated transition"
                  >
                    <Avatar initials={initials} color="oklch(0.7 0.15 200)" size={40} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{row.name}</div>
                      <div className="text-[10px] text-mono text-muted-foreground">
                        {row.cameraName} · {new Date(row.createdAt).toLocaleTimeString()}
                      </div>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] font-bold text-success text-mono">MATCH</span>
                      <span className="text-[10px] text-muted-foreground text-mono">
                        {Math.round((row.confidence || 0) * 100)}%
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
            <Link
              to="/people"
              className="p-3 border-t border-border text-center text-xs text-muted-foreground hover:text-foreground transition"
            >
              View people registry →
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}

function formatDelta(n: number): string {
  if (!isFinite(n)) return "—";
  const sign = n > 0 ? "↑" : n < 0 ? "↓" : "·";
  return `${sign} ${Math.abs(n).toFixed(1)}%`;
}
