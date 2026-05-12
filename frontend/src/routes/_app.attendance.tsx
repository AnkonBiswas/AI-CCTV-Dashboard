import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download, Calendar as CalendarIcon } from "lucide-react";
import { Avatar, StatCard } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAnalyticsDaywise, useEnrollments } from "@/hooks/queries";
import type { DaywiseRow, Enrollment } from "@/types/api";

export const Route = createFileRoute("/_app/attendance")({
  staticData: { title: "Attendance", subtitle: "Date-wise presence captured automatically by face recognition" },
  component: AttendancePage,
});

const RANGES = { "7d": 7, "14d": 14, "30d": 30, "90d": 90 } as const;
type RangeKey = keyof typeof RANGES;

const LATE_HOUR = 9; // first-seen at or after 09:00 is "late"
const WEEKDAY_LABELS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

function AttendancePage() {
  const [range, setRange] = useState<RangeKey>("7d");
  const days = RANGES[range];
  const daywise = useAnalyticsDaywise(days);
  const enrollments = useEnrollments();

  const rows: DaywiseRow[] = daywise.data?.rows ?? [];
  const enrolled: Enrollment[] = enrollments.data ?? [];

  // Group rows by day, oldest → newest, fill missing days so weekends show as empty bars.
  // Use local-time YYYY-MM-DD to align with the backend's DATE_FORMAT (which
  // uses MySQL's session timezone, typically the server's local TZ).
  const byDay = useMemo(() => {
    const map = new Map<string, DaywiseRow[]>();
    for (const r of rows) {
      if (!map.has(r.day)) map.set(r.day, []);
      map.get(r.day)!.push(r);
    }
    const out: { day: string; rows: DaywiseRow[]; date: Date }[] = [];
    const end = new Date();
    for (let i = days - 1; i >= 0; i -= 1) {
      const d = new Date(end);
      d.setDate(end.getDate() - i);
      out.push({ day: localISODate(d), rows: map.get(localISODate(d)) ?? [], date: d });
    }
    return out;
  }, [rows, days]);

  const today = localISODate(new Date());
  const todayRows = rows.filter((r) => r.day === today);

  const avgAttendance = useMemo(() => {
    if (byDay.length === 0 || enrolled.length === 0) return null;
    const sumPct =
      byDay.reduce((acc, b) => acc + b.rows.length / enrolled.length, 0) / byDay.length;
    return Math.round(sumPct * 1000) / 10;
  }, [byDay, enrolled.length]);

  const lateArrivals = useMemo(() => {
    let n = 0;
    for (const r of rows) {
      if (!r.firstSeen) continue;
      const h = new Date(r.firstSeen).getHours();
      if (h >= LATE_HOUR) n += 1;
    }
    return n;
  }, [rows]);

  const todaySet = useMemo(() => new Set(todayRows.map((r) => r.nameKey)), [todayRows]);
  const todayByKey = useMemo(() => new Map(todayRows.map((r) => [r.nameKey, r])), [todayRows]);

  // Sanitized names from the backend strip non-alphanumerics and convert
  // spaces to underscores; we need to compare against enrollment.name which
  // uses the same shape.
  const log = useMemo(() => {
    const merged: { name: string; row?: DaywiseRow; present: boolean }[] = [];
    for (const e of enrolled) {
      const present = todaySet.has(e.name);
      merged.push({ name: e.name, row: todayByKey.get(e.name), present });
    }
    return merged.sort((a, b) => {
      if (a.present !== b.present) return a.present ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [enrolled, todaySet, todayByKey]);

  const dateRangeLabel = useMemo(() => {
    if (byDay.length === 0) return "—";
    const first = byDay[0].date;
    const last = byDay[byDay.length - 1].date;
    const sameYear = first.getFullYear() === last.getFullYear();
    const fmt: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    const a = first.toLocaleDateString(undefined, fmt);
    const b = last.toLocaleDateString(undefined, fmt);
    return `${a} – ${b}, ${last.getFullYear()}${sameYear ? "" : ""}`;
  }, [byDay]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of enrolled) c[e.type] = (c[e.type] || 0) + 1;
    return c;
  }, [enrolled]);
  const totalEnrolled = enrolled.length || 0;

  function exportCsv() {
    const headers = ["Date", "Name", "Detections", "Check-in", "Last seen", "Hours", "Cameras"];
    const lines = [headers.join(",")];
    for (const r of rows) {
      const hours =
        r.firstSeen && r.lastSeen ? diffHm(r.firstSeen, r.lastSeen) : "";
      lines.push(
        [
          // Force-text formula so Excel doesn't auto-convert and squash the
          // date into the ######## state.
          excelText(r.day),
          escapeCsv(r.name),
          r.n,
          excelText(r.firstSeen ? formatTime(r.firstSeen) : ""),
          excelText(r.lastSeen ? formatTime(r.lastSeen) : ""),
          excelText(hours),
          escapeCsv(r.cameras.join("; ")),
        ].join(","),
      );
    }
    // BOM so Excel opens it as UTF-8 (preserves non-ASCII names).
    const blob = new Blob(["\uFEFF", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-${range}-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="inline-flex items-center gap-2 px-3 h-9 rounded-md bg-panel border border-border text-xs text-mono">
          <CalendarIcon className="size-3.5 text-muted-foreground" />
          <span>{dateRangeLabel}</span>
          <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
            <SelectTrigger className="h-7 w-20 border-0 bg-transparent text-[11px] text-mono px-2 focus:ring-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.keys(RANGES).map((k) => (
                <SelectItem key={k} value={k} className="text-mono">
                  {k.toUpperCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={exportCsv}>
          <Download className="size-3.5" /> Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Avg attendance"
          value={avgAttendance == null ? "—" : `${avgAttendance}%`}
          delta={enrolled.length === 0 ? "Enroll people to enable" : `vs ${enrolled.length} enrolled`}
          tone="success"
        />
        <StatCard
          label="Days tracked"
          value={String(byDay.filter((b) => b.rows.length > 0).length)}
          delta={`Window ${range.toUpperCase()}`}
        />
        <StatCard
          label="Late arrivals"
          value={String(lateArrivals)}
          delta={`First-seen ≥ ${String(LATE_HOUR).padStart(2, "0")}:00`}
          tone={lateArrivals > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Auto-logged"
          value="100%"
          delta="Zero manual entries"
          tone="success"
        />
      </div>

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 xl:col-span-8 bg-panel border border-border rounded-xl p-5">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground text-mono">
            Daily Attendance
          </div>
          <div className="mt-1 text-sm font-semibold">Present vs absent · last {byDay.length} days</div>

          {byDay.length === 0 ? (
            <div className="mt-10 text-xs text-muted-foreground text-mono text-center pb-6">
              No attendance data yet.
            </div>
          ) : (
            <DailyBars buckets={byDay} totalEnrolled={totalEnrolled} />
          )}
        </div>

        <div className="col-span-12 xl:col-span-4 bg-panel border border-border rounded-xl p-5">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground text-mono">
            Category breakdown
          </div>
          <div className="mt-1 text-sm font-semibold">Enrolled identities by type</div>
          <div className="mt-4 space-y-3">
            {Object.keys(counts).length === 0 ? (
              <div className="text-xs text-muted-foreground text-mono">No enrollments yet.</div>
            ) : (
              Object.entries(counts)
                .sort(([, a], [, b]) => b - a)
                .map(([type, n]) => {
                  const pct = totalEnrolled ? Math.round((n / totalEnrolled) * 100) : 0;
                  return (
                    <div key={type}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="capitalize">{type}</span>
                        <span className="text-mono text-muted-foreground">
                          {n} · {pct}%
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-panel-elevated overflow-hidden">
                        <div
                          className={`h-full ${TYPE_BAR[type] ?? "bg-primary"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        </div>
      </div>

      <div className="bg-panel border border-border rounded-xl">
        <div className="p-4 border-b border-border">
          <div className="text-sm font-semibold">Today's Log</div>
          <div className="text-xs text-muted-foreground text-mono">
            First check-in to last seen, captured per person · {today}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-mono text-muted-foreground border-b border-border">
                <th className="px-5 py-3 font-medium">Person</th>
                <th className="px-5 py-3 font-medium">Check-in</th>
                <th className="px-5 py-3 font-medium">Last seen</th>
                <th className="px-5 py-3 font-medium">Hours</th>
                <th className="px-5 py-3 font-medium">Cameras visited</th>
                <th className="px-5 py-3 font-medium text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {log.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-xs text-muted-foreground text-center">
                    No enrolled people. Enroll someone from the People Registry to start tracking.
                  </td>
                </tr>
              ) : (
                log.map((entry) => <LogRow key={entry.name} entry={entry} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function DailyBars({
  buckets,
  totalEnrolled,
}: {
  buckets: { day: string; rows: DaywiseRow[]; date: Date }[];
  totalEnrolled: number;
}) {
  const max = Math.max(1, ...buckets.map((b) => b.rows.length), totalEnrolled);
  return (
    <div className="mt-6 flex gap-3 h-44">
      {buckets.map((b) => {
        const n = b.rows.length;
        const pct = (n / max) * 100;
        const dow = b.date.getDay();
        const isWeekend = dow === 0 || dow === 6;
        const tone = n === 0
          ? "from-muted/30 to-muted/60"
          : isWeekend
            ? "from-primary/15 to-primary/40"
            : "from-primary/30 to-primary/80";
        return (
          <div key={b.day} className="flex-1 flex flex-col items-center gap-2 group min-w-0">
            <div className="text-[11px] text-mono tabular-nums text-muted-foreground group-hover:text-foreground">
              {n}
            </div>
            <div className="w-full flex-1 flex items-end">
              <div
                className={`w-full rounded-t-sm bg-gradient-to-t ${tone} shadow-[0_0_12px_color-mix(in_oklab,var(--primary)_20%,transparent)]`}
                style={{ height: `${Math.max(2, pct)}%` }}
                title={`${n} present on ${b.day}`}
              />
            </div>
            <div className="text-[10px] text-mono text-muted-foreground">
              {WEEKDAY_LABELS[b.date.getDay()]}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LogRow({ entry }: { entry: { name: string; row?: DaywiseRow; present: boolean } }) {
  const display = displayName(entry.name);
  const initials = (display[0] || "?").toUpperCase();
  const color = avatarColor(entry.name);
  const checkIn = entry.row?.firstSeen ? formatTime(entry.row.firstSeen) : "—";
  const lastSeen = entry.row?.lastSeen ? formatTime(entry.row.lastSeen) : "—";
  const hours =
    entry.row?.firstSeen && entry.row?.lastSeen
      ? diffHm(entry.row.firstSeen, entry.row.lastSeen)
      : "—";
  const cameras = entry.row?.cameras ?? [];
  const late =
    entry.row?.firstSeen && new Date(entry.row.firstSeen).getHours() >= LATE_HOUR;

  return (
    <tr className="hover:bg-panel-elevated transition">
      <td className="px-5 py-3">
        <div className="flex items-center gap-3">
          <Avatar initials={initials} color={color} size={32} />
          <div className="min-w-0">
            <div className="font-semibold truncate">{display}</div>
            <div className="text-[10px] text-mono text-muted-foreground">{entry.name}</div>
          </div>
        </div>
      </td>
      <td className="px-5 py-3 text-mono text-xs">
        {checkIn}
        {late && (
          <span className="ml-2 text-[9px] text-mono uppercase bg-warning/15 text-warning border border-warning/30 rounded px-1 py-0.5">
            late
          </span>
        )}
      </td>
      <td className="px-5 py-3 text-mono text-xs text-muted-foreground">{lastSeen}</td>
      <td className="px-5 py-3 text-mono text-xs">{hours}</td>
      <td className="px-5 py-3">
        {cameras.length === 0 ? (
          <span className="text-mono text-xs text-muted-foreground">—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {cameras.map((c) => (
              <span
                key={c}
                className="text-[10px] text-mono uppercase tracking-wider bg-panel-elevated border border-border rounded px-1.5 py-0.5"
              >
                {c}
              </span>
            ))}
          </div>
        )}
      </td>
      <td className="px-5 py-3 text-right">
        <span
          className={`inline-flex items-center gap-1.5 text-[10px] text-mono uppercase font-bold tracking-wider px-2 py-0.5 rounded-full border ${
            entry.present
              ? "bg-success/15 text-success border-success/30"
              : "bg-muted text-muted-foreground border-border"
          }`}
        >
          <span className="size-1.5 rounded-full bg-current" />
          {entry.present ? "Present" : "Absent"}
        </span>
      </td>
    </tr>
  );
}

const TYPE_BAR: Record<string, string> = {
  threat: "bg-destructive",
  vip: "bg-warning",
  staff: "bg-primary",
  visitor: "bg-muted-foreground",
  standard: "bg-success",
};

function displayName(sanitized: string): string {
  return sanitized.replace(/_/g, " ");
}

function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  return `oklch(0.7 0.16 ${hue})`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function diffHm(aIso: string, bIso: string): string {
  const ms = Math.max(0, new Date(bIso).getTime() - new Date(aIso).getTime());
  const total = Math.floor(ms / 60000);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}h ${pad2(m)}m`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function localISODate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function escapeCsv(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Wraps a value so Excel keeps it as literal text instead of auto-converting
// "2026-05-12" → a Date that overflows the column and renders as ########.
// The `="..."` formula form works in Excel, Numbers, and LibreOffice; CSV
// parsers that don't know about it simply see the equals and quotes as data.
function excelText(s: string): string {
  if (!s) return "";
  return `="${String(s).replace(/"/g, '""')}"`;
}
