import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Search, ArrowRight, UserSearch } from "lucide-react";
import { EmptyHint, StatCard } from "@/components/AppShell";
import { LeafletMap } from "@/components/LeafletMap";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEnrollments, usePersonActivity } from "@/hooks/queries";

export const Route = createFileRoute("/_app/tracking")({
  staticData: { title: "Tracking", subtitle: "Multi-camera subject movement" },
  component: TrackingPage,
});

function TrackingPage() {
  const navigate = useNavigate();
  const enrollments = useEnrollments();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const activity = usePersonActivity(picked ?? undefined, { days: 7 });

  const enrolled = enrollments.data ?? [];
  const matches = query
    ? enrolled.filter((e) => e.name.toLowerCase().includes(query.toLowerCase()))
    : enrolled.slice(0, 6);

  const stops =
    (activity.data?.timeline ?? [])
      .filter((t) => t.lat != null && t.lng != null)
      .map((t) => ({
        lat: Number(t.lat),
        lng: Number(t.lng),
        popup: `${escapeHtml(t.cameraName)}<br/><span style="font-family:JetBrains Mono,monospace;font-size:11px">${new Date(t.createdAt).toLocaleString()}</span>`,
      })) ?? [];

  return (
    <div className="p-8 space-y-6">
      <div className="bg-panel border border-border rounded-xl p-5">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-[260px] h-10 px-3 rounded-md bg-panel-elevated border border-border text-xs">
            <Search className="size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search a person to track…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="border-0 bg-transparent h-7 p-0 text-xs focus-visible:ring-0"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {matches.map((p) => (
              <button
                key={p.name}
                onClick={() => setPicked(p.name)}
                className={`text-[11px] text-mono px-2 py-1 rounded-md border transition ${
                  picked === p.name
                    ? "bg-primary/15 text-primary border-primary/30"
                    : "bg-panel-elevated border-border hover:text-foreground text-muted-foreground"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!picked ? (
        <div className="rounded-xl border border-border bg-panel py-12">
          <EmptyHint
            icon={UserSearch}
            title="Pick a person to view their movement"
            description="Tracking requires cameras with set lat/lng. Set coordinates from the Cameras page."
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Subject" value={activity.data?.displayName ?? picked} />
            <StatCard label="Detections" value={String(activity.data?.summary.total ?? 0)} />
            <StatCard
              label="Cameras"
              value={String(activity.data?.summary.distinctCameras ?? 0)}
            />
            <StatCard label="Days" value={String(activity.data?.summary.distinctDays ?? 0)} />
          </div>

          <div className="grid grid-cols-12 gap-6">
            <div className="col-span-12 xl:col-span-8 bg-panel border border-border rounded-xl p-1">
              <div className="px-3 py-2 text-[10px] uppercase tracking-widest text-mono text-muted-foreground">
                Movement Path
              </div>
              {stops.length === 0 ? (
                <div className="h-[420px] grid place-items-center">
                  <EmptyHint
                    icon={UserSearch}
                    title="No geocoded detections yet"
                    description="Set lat/lng on the contributing cameras to see them on the map."
                  />
                </div>
              ) : (
                <LeafletMap mode="path" stops={stops} className="h-[420px] rounded-md" />
              )}
            </div>

            <aside className="col-span-12 xl:col-span-4 bg-panel border border-border rounded-xl">
              <div className="p-4 border-b border-border">
                <div className="text-[10px] uppercase tracking-widest text-mono text-muted-foreground">
                  Recent Timeline
                </div>
              </div>
              <div className="max-h-[420px] overflow-y-auto divide-y divide-border">
                {(activity.data?.timeline ?? []).slice(0, 25).map((t) => (
                  <div key={t.id} className="px-4 py-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <div className="text-mono">{t.cameraName}</div>
                      <div className="text-mono text-muted-foreground">
                        {Math.round((t.confidence || 0) * 100)}%
                      </div>
                    </div>
                    <div className="text-[10px] text-muted-foreground text-mono">
                      {new Date(t.createdAt).toLocaleString()}
                    </div>
                  </div>
                ))}
                {(activity.data?.timeline ?? []).length === 0 && (
                  <div className="p-6 text-xs text-muted-foreground text-center">
                    No timeline entries
                  </div>
                )}
              </div>
              <Button
                variant="outline"
                onClick={() => navigate({ to: "/person/$name", params: { name: picked } })}
                className="m-3"
              >
                Full activity <ArrowRight className="size-3.5" />
              </Button>
            </aside>
          </div>
        </>
      )}
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
