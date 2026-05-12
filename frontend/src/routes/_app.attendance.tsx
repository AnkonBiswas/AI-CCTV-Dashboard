import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download, CalendarDays } from "lucide-react";
import { Avatar, StatCard } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAnalyticsDaywise } from "@/hooks/queries";
import type { DaywiseRow } from "@/types/api";

export const Route = createFileRoute("/_app/attendance")({
  staticData: { title: "Attendance", subtitle: "Daily presence aggregated from face recognition" },
  component: AttendancePage,
});

const RANGES: Record<string, number> = { "7d": 7, "14d": 14, "30d": 30, "90d": 90 };

function AttendancePage() {
  const [range, setRange] = useState<keyof typeof RANGES>("7d");
  const days = RANGES[range];
  const q = useAnalyticsDaywise(days);

  const rows = q.data?.rows ?? [];

  const byDay = useMemo(() => {
    const map = new Map<string, DaywiseRow[]>();
    for (const r of rows) {
      if (!map.has(r.day)) map.set(r.day, []);
      map.get(r.day)!.push(r);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  const today = new Date().toISOString().slice(0, 10);
  const todayRows = rows.filter((r) => r.day === today);

  function exportCsv() {
    const headers = ["day", "name", "detections", "firstSeen", "lastSeen", "cameras"];
    const lines = [headers.join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.day,
          escapeCsv(r.name),
          r.n,
          r.firstSeen ?? "",
          r.lastSeen ?? "",
          escapeCsv(r.cameras.join("; ")),
        ].join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-${range}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-8 space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Range" value={range.toUpperCase()} />
        <StatCard label="Days tracked" value={String(byDay.length)} />
        <StatCard label="Today's people" value={String(todayRows.length)} tone="success" />
        <StatCard
          label="Today's detections"
          value={String(todayRows.reduce((a, b) => a + b.n, 0))}
        />
      </div>

      <div className="bg-panel border border-border rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground text-mono">
              Daily Presence
            </div>
            <div className="mt-1 text-sm font-semibold">Unique people seen per day</div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={range} onValueChange={(v) => setRange(v as keyof typeof RANGES)}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.keys(RANGES).map((k) => (
                  <SelectItem key={k} value={k}>
                    {k.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={exportCsv}>
              <Download className="size-3.5" /> Export CSV
            </Button>
          </div>
        </div>
        <div className="mt-6 flex items-end gap-3 h-32">
          {byDay.length === 0 ? (
            <div className="text-xs text-muted-foreground text-mono w-full text-center pt-12">
              No attendance data
            </div>
          ) : (
            byDay.map(([day, list]) => {
              const max = Math.max(...byDay.map(([, l]) => l.length));
              const pct = (list.length / Math.max(1, max)) * 100;
              return (
                <div key={day} className="flex-1 flex flex-col items-center gap-2">
                  <div className="w-full flex-1 flex items-end">
                    <div
                      className="w-full rounded-t-sm bg-gradient-to-t from-primary/30 to-primary/80"
                      style={{ height: `${pct}%` }}
                      title={`${list.length} people on ${day}`}
                    />
                  </div>
                  <div className="text-[10px] text-mono text-muted-foreground">
                    {day.slice(5)}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="bg-panel border border-border rounded-xl">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground text-mono">
              Today's log
            </div>
            <div className="mt-1 text-sm font-semibold flex items-center gap-2">
              <CalendarDays className="size-3.5 text-muted-foreground" /> {today}
            </div>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-widest text-mono text-muted-foreground border-b border-border">
              <th className="px-5 py-3 font-medium">Person</th>
              <th className="px-5 py-3 font-medium">First seen</th>
              <th className="px-5 py-3 font-medium">Last seen</th>
              <th className="px-5 py-3 font-medium">Detections</th>
              <th className="px-5 py-3 font-medium">Cameras</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {todayRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-xs text-muted-foreground text-center">
                  No detections today yet.
                </td>
              </tr>
            ) : (
              todayRows.map((r) => (
                <tr key={r.nameKey} className="hover:bg-panel-elevated transition">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar
                        initials={(r.name[0] || "?").toUpperCase()}
                        color="oklch(0.7 0.15 200)"
                        size={32}
                      />
                      <span className="font-semibold">{r.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-mono text-xs text-muted-foreground">
                    {r.firstSeen ? new Date(r.firstSeen).toLocaleTimeString() : "—"}
                  </td>
                  <td className="px-5 py-3 text-mono text-xs text-muted-foreground">
                    {r.lastSeen ? new Date(r.lastSeen).toLocaleTimeString() : "—"}
                  </td>
                  <td className="px-5 py-3 text-mono text-xs">{r.n}</td>
                  <td className="px-5 py-3 text-mono text-[11px] text-muted-foreground">
                    {r.cameras.join(", ")}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function escapeCsv(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
