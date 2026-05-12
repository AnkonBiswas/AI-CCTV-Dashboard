import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { StatCard } from "@/components/AppShell";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAnalyticsCharts } from "@/hooks/queries";

export const Route = createFileRoute("/_app/heatmap")({
  staticData: { title: "Heatmap", subtitle: "Day-of-week × hour density" },
  component: HeatmapPage,
});

const RANGES = ["7", "14", "30", "90"] as const;
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function HeatmapPage() {
  const [days, setDays] = useState<(typeof RANGES)[number]>("7");
  const q = useAnalyticsCharts(Number(days));

  const grid = useMemo(() => {
    const g: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const cell of q.data?.heatmap ?? []) {
      const dow = cell.dow === 0 ? 6 : cell.dow - 1; // shift Sunday(0) → 6 so Mon=0
      g[dow][cell.hour] = cell.n;
    }
    return g;
  }, [q.data]);

  const max = Math.max(1, ...grid.flat());
  const peakHour = q.data?.heatmap.reduce<{ hour: number; n: number } | null>((acc, cell) => {
    if (!acc || cell.n > acc.n) return { hour: cell.hour, n: cell.n };
    return acc;
  }, null);
  const topCamera = q.data?.byCamera[0];
  const topPerson = q.data?.byPerson[0];

  return (
    <div className="p-8 space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Range" value={`${days} days`} />
        <StatCard
          label="Peak hour"
          value={peakHour ? `${String(peakHour.hour).padStart(2, "0")}:00` : "—"}
          delta={peakHour ? `${peakHour.n} detections` : undefined}
        />
        <StatCard label="Top camera" value={topCamera?.camera ?? "—"} />
        <StatCard label="Top person" value={topPerson?.name ?? "—"} />
      </div>

      <div className="bg-panel border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground text-mono">
              Activity Heatmap
            </div>
            <div className="mt-1 text-sm font-semibold">Total detections by day-of-week and hour</div>
          </div>
          <Select value={days} onValueChange={(v) => setDays(v as (typeof RANGES)[number])}>
            <SelectTrigger className="w-28">
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

        <div className="overflow-x-auto">
          <div className="inline-block min-w-full">
            <div className="grid grid-cols-[3rem_repeat(24,minmax(20px,1fr))] gap-px text-[9px] text-mono text-muted-foreground">
              <div />
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="text-center">
                  {h}
                </div>
              ))}
              {DOW.map((d, di) => (
                <Row key={d} day={d} cells={grid[di]} max={max} />
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 text-[10px] text-mono text-muted-foreground">
          <span>Low</span>
          <div className="h-2 w-32 rounded-full bg-gradient-to-r from-primary/10 via-primary/60 to-primary" />
          <span>High</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <BreakdownPanel title="Top cameras" items={q.data?.byCamera ?? []} keyOf={(x) => x.camera} />
        <BreakdownPanel title="Top people" items={q.data?.byPerson ?? []} keyOf={(x) => x.name} />
      </div>
    </div>
  );
}

function Row({ day, cells, max }: { day: string; cells: number[]; max: number }) {
  return (
    <>
      <div className="pr-2 grid place-items-end uppercase">{day}</div>
      {cells.map((n, h) => {
        const t = n / max;
        const bg =
          n === 0
            ? "var(--panel-elevated)"
            : `color-mix(in oklab, var(--primary) ${Math.max(8, Math.round(t * 90))}%, transparent)`;
        return (
          <div
            key={h}
            className="h-6 rounded-sm border border-border"
            style={{ background: bg }}
            title={`${day} ${String(h).padStart(2, "0")}:00 — ${n}`}
          />
        );
      })}
    </>
  );
}

function BreakdownPanel<T extends { n: number }>({
  title,
  items,
  keyOf,
}: {
  title: string;
  items: T[];
  keyOf: (item: T) => string;
}) {
  const max = Math.max(1, ...items.map((i) => i.n));
  return (
    <div className="bg-panel border border-border rounded-xl p-5">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground text-mono">
        {title}
      </div>
      <div className="mt-4 space-y-2">
        {items.length === 0 && (
          <div className="text-xs text-muted-foreground text-mono">No data</div>
        )}
        {items.map((i) => (
          <div key={keyOf(i)} className="flex items-center gap-3">
            <div className="w-32 text-xs truncate">{keyOf(i)}</div>
            <div className="flex-1 h-2 rounded-full bg-panel-elevated overflow-hidden">
              <div
                className="h-full bg-primary"
                style={{ width: `${(i.n / max) * 100}%` }}
              />
            </div>
            <div className="text-[11px] text-mono text-muted-foreground w-10 text-right">{i.n}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
