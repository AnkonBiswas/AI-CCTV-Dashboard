import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Search, ArrowRight, UserSearch, MapPin, CalendarDays } from "lucide-react";
import { EmptyHint, StatCard } from "@/components/AppShell";
import { LeafletMap } from "@/components/LeafletMap";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCameras, useEnrollments, usePersonActivity } from "@/hooks/queries";

export const Route = createFileRoute("/_app/tracking")({
  staticData: { title: "Tracking", subtitle: "Multi-camera subject movement" },
  component: TrackingPage,
});

type Filter =
  | { kind: "rolling"; days: number }
  | { kind: "date"; date: string };

function TrackingPage() {
  const navigate = useNavigate();
  const enrollments = useEnrollments();
  const cameras = useCameras();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>({ kind: "date", date: localISODate(new Date()) });

  const activityOpts =
    filter.kind === "date" ? { date: filter.date } : { days: filter.days };
  const activity = usePersonActivity(picked ?? undefined, activityOpts);

  const enrolled = enrollments.data ?? [];
  const matches = query
    ? enrolled.filter((e) => e.name.toLowerCase().includes(query.toLowerCase()))
    : enrolled.slice(0, 6);

  const timeline = activity.data?.timeline ?? [];
  const stops = useMemo(
    () =>
      timeline
        .filter((t) => t.lat != null && t.lng != null)
        .map((t) => ({
          lat: Number(t.lat),
          lng: Number(t.lng),
          popup: `<strong>${escapeHtml(t.cameraName)}</strong><br/><span style="font-family:JetBrains Mono,monospace;font-size:11px">${new Date(t.createdAt).toLocaleString()}</span>`,
        })),
    [timeline],
  );

  const cams = cameras.data ?? [];
  const camsWithoutLoc = useMemo(() => {
    const seen = new Set(timeline.map((t) => t.cameraName));
    return cams.filter((c) => seen.has(c.cameraName) && (c.lat == null || c.lng == null));
  }, [cams, timeline]);

  const filterLabel = filterDisplay(filter);

  return (
    <div className="p-8 space-y-6">
      <div className="bg-panel border border-border rounded-xl p-5 space-y-3">
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

        <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-border">
          <div className="inline-flex items-center gap-2 text-[10px] text-mono uppercase tracking-wider text-muted-foreground">
            <CalendarDays className="size-3.5" /> Day
          </div>
          <FilterChip
            active={filter.kind === "date" && filter.date === localISODate(new Date())}
            onClick={() => setFilter({ kind: "date", date: localISODate(new Date()) })}
          >
            Today
          </FilterChip>
          <FilterChip
            active={filter.kind === "date" && filter.date === localISODate(addDays(new Date(), -1))}
            onClick={() => setFilter({ kind: "date", date: localISODate(addDays(new Date(), -1)) })}
          >
            Yesterday
          </FilterChip>
          <FilterChip
            active={filter.kind === "rolling" && filter.days === 7}
            onClick={() => setFilter({ kind: "rolling", days: 7 })}
          >
            Last 7 days
          </FilterChip>
          <FilterChip
            active={filter.kind === "rolling" && filter.days === 30}
            onClick={() => setFilter({ kind: "rolling", days: 30 })}
          >
            Last 30 days
          </FilterChip>
          <Input
            type="date"
            value={filter.kind === "date" ? filter.date : ""}
            max={localISODate(new Date())}
            onChange={(e) =>
              e.target.value && setFilter({ kind: "date", date: e.target.value })
            }
            className="h-7 w-[140px] text-[11px] text-mono bg-panel-elevated border-border"
          />
        </div>
      </div>

      {!picked ? (
        <div className="rounded-xl border border-border bg-panel py-12">
          <EmptyHint
            icon={UserSearch}
            title="Pick a person to view their movement"
            description="Choose someone from the chips above. Set lat/lng on the cameras to plot a path."
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Subject" value={activity.data?.displayName ?? picked} />
            <StatCard label="Detections" value={String(activity.data?.summary.total ?? 0)} delta={filterLabel} />
            <StatCard
              label="Cameras"
              value={String(activity.data?.summary.distinctCameras ?? 0)}
            />
            <StatCard label="Days" value={String(activity.data?.summary.distinctDays ?? 0)} />
          </div>

          <div className="grid grid-cols-12 gap-6">
            <div className="col-span-12 xl:col-span-8 bg-panel border border-border rounded-xl p-1">
              <div className="px-3 py-2 flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-widest text-mono text-muted-foreground">
                  Movement Path · {filterLabel}
                </div>
                {stops.length > 0 && (
                  <div className="text-[10px] text-mono text-muted-foreground">
                    {stops.length} geocoded stops
                  </div>
                )}
              </div>
              {stops.length === 0 ? (
                <NoGeocodedHint cameras={camsWithoutLoc.map((c) => c.cameraName)} />
              ) : (
                <LeafletMap mode="path" stops={stops} className="h-[420px] rounded-md" />
              )}
            </div>

            <aside className="col-span-12 xl:col-span-4 bg-panel border border-border rounded-xl">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-mono text-muted-foreground">
                    Timeline
                  </div>
                  <div className="text-xs text-muted-foreground text-mono">
                    {filterLabel}
                  </div>
                </div>
                {activity.isFetching && (
                  <span className="text-[10px] text-mono text-muted-foreground">…</span>
                )}
              </div>
              <div className="max-h-[420px] overflow-y-auto divide-y divide-border">
                {timeline.slice(0, 50).map((t) => (
                  <div key={t.id} className="px-4 py-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <div className="text-mono flex items-center gap-1.5">
                        {t.lat != null && t.lng != null && (
                          <MapPin className="size-3 text-primary" />
                        )}
                        {t.cameraName}
                      </div>
                      <div className="text-mono text-muted-foreground">
                        {Math.round((t.confidence || 0) * 100)}%
                      </div>
                    </div>
                    <div className="text-[10px] text-muted-foreground text-mono">
                      {new Date(t.createdAt).toLocaleString()}
                    </div>
                  </div>
                ))}
                {timeline.length === 0 && (
                  <div className="p-6 text-xs text-muted-foreground text-center">
                    No detections for {filterLabel.toLowerCase()}.
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

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-[11px] text-mono px-2.5 py-1 rounded-md border transition ${
        active
          ? "bg-primary/15 text-primary border-primary/30"
          : "bg-panel-elevated border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function NoGeocodedHint({ cameras }: { cameras: string[] }) {
  return (
    <div className="h-[420px] flex flex-col items-center justify-center text-center px-6 gap-3">
      <div className="size-12 rounded-full bg-panel-elevated grid place-items-center text-muted-foreground">
        <MapPin className="size-5" />
      </div>
      <div className="text-sm font-semibold">No geocoded detections to plot</div>
      {cameras.length > 0 ? (
        <div className="text-xs text-muted-foreground max-w-md">
          {cameras.length === 1 ? "Camera " : "Cameras "}
          <span className="text-mono text-foreground">{cameras.join(", ")}</span>{" "}
          recorded this subject but {cameras.length === 1 ? "has" : "have"} no coordinates.
          Set lat/lng from the{" "}
          <Link to="/cameras" className="text-primary hover:underline">
            Cameras page
          </Link>{" "}
          to draw the path.
        </div>
      ) : (
        <div className="text-xs text-muted-foreground max-w-md">
          No detections in this window, or the contributing cameras have no coordinates.
          Add lat/lng from the{" "}
          <Link to="/cameras" className="text-primary hover:underline">
            Cameras page
          </Link>
          .
        </div>
      )}
    </div>
  );
}

function filterDisplay(f: Filter): string {
  if (f.kind === "date") {
    const todayKey = localISODate(new Date());
    const ydayKey = localISODate(addDays(new Date(), -1));
    if (f.date === todayKey) return "Today";
    if (f.date === ydayKey) return "Yesterday";
    return f.date;
  }
  return `Last ${f.days} days`;
}

function localISODate(d: Date): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(d.getDate() + n);
  return x;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
