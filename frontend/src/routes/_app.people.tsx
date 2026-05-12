import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, Search, ImagePlus, Pencil, Trash2, UserSearch, Users } from "lucide-react";
import { toast } from "sonner";
import { Avatar, EmptyHint, StatCard } from "@/components/AppShell";
import { EnrollPersonDialog } from "@/components/EnrollPersonDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buildAssetUrl } from "@/lib/api";
import { useDeleteEnrollment, useEnrollments } from "@/hooks/queries";
import type { Enrollment } from "@/types/api";

export const Route = createFileRoute("/_app/people")({
  staticData: { title: "People Registry", subtitle: "Enrolled identities and recognition history" },
  component: PeoplePage,
});

const TYPE_TONES: Record<string, string> = {
  threat: "bg-destructive/15 text-destructive border-destructive/30",
  vip: "bg-warning/15 text-warning border-warning/30",
  staff: "bg-primary/15 text-primary border-primary/30",
  visitor: "bg-muted text-muted-foreground border-border",
  standard: "bg-success/15 text-success border-success/30",
};

function PeoplePage() {
  const enrollments = useEnrollments();
  const del = useDeleteEnrollment();
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<
    | { mode: "add" | "edit" | "photos"; target?: Enrollment | null; open: true }
    | { mode: "add"; open: false }
  >({ mode: "add", open: false });
  const [removing, setRemoving] = useState<Enrollment | null>(null);

  const rows = enrollments.data ?? [];
  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) => r.name.toLowerCase().includes(q) || r.type.toLowerCase().includes(q));
  }, [rows, search]);

  const counts = useMemo(() => {
    const totals = { threat: 0, vip: 0, staff: 0, visitor: 0, standard: 0 };
    for (const r of rows) totals[r.type] = (totals[r.type] || 0) + 1;
    return totals;
  }, [rows]);

  async function confirmDelete() {
    if (!removing) return;
    try {
      await del.mutateAsync(removing.name);
      toast.success(`Removed ${removing.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="p-8 space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Enrolled" value={String(rows.length)} />
        <StatCard label="Staff + VIP" value={String(counts.staff + counts.vip)} tone="success" />
        <StatCard
          label="Threats"
          value={String(counts.threat)}
          tone={counts.threat > 0 ? "destructive" : "default"}
        />
        <StatCard label="Visitors" value={String(counts.visitor)} />
      </div>

      <div className="bg-panel border border-border rounded-xl">
        <div className="p-4 flex items-center gap-3 border-b border-border">
          <div className="flex items-center gap-2 flex-1 h-9 px-3 rounded-md bg-panel-elevated border border-border text-xs">
            <Search className="size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search by name or category…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border-0 bg-transparent h-7 p-0 text-xs focus-visible:ring-0"
            />
          </div>
          <Button onClick={() => setDialog({ mode: "add", open: true })}>
            <Plus className="size-3.5" /> Enroll person
          </Button>
        </div>

        {filtered.length === 0 ? (
          <EmptyHint
            icon={rows.length === 0 ? Users : UserSearch}
            title={rows.length === 0 ? "No people enrolled yet" : "No matches"}
            description={
              rows.length === 0
                ? "Click Enroll Person to add photos and start recognition."
                : undefined
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 p-4">
            {filtered.map((p) => (
              <div key={p.name} className="rounded-md border border-border bg-panel-elevated overflow-hidden">
                <div className="aspect-video bg-background grid place-items-center">
                  <img
                    src={buildAssetUrl(`/enrollment/${encodeURIComponent(p.name)}/image`)}
                    alt={p.name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />
                </div>
                <div className="p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar
                        initials={(p.name[0] || "?").toUpperCase()}
                        color="oklch(0.7 0.15 200)"
                        size={28}
                      />
                      <div className="text-sm font-semibold truncate">{p.name}</div>
                    </div>
                    <span
                      className={`text-[10px] text-mono uppercase px-1.5 py-0.5 border rounded ${
                        TYPE_TONES[p.type] ?? TYPE_TONES.standard
                      }`}
                    >
                      {p.type}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground text-mono">
                    {p.photoCount} {p.photoCount === 1 ? "photo" : "photos"}
                  </div>
                  <div className="grid grid-cols-4 gap-1.5 pt-1">
                    <Link
                      to="/person/$name"
                      params={{ name: p.name }}
                      className="h-8 px-2 rounded-md bg-panel hover:bg-background text-[11px] text-mono flex items-center justify-center gap-1"
                    >
                      <UserSearch className="size-3" /> Activity
                    </Link>
                    <button
                      onClick={() => setDialog({ mode: "edit", target: p, open: true })}
                      className="h-8 px-2 rounded-md bg-panel hover:bg-background text-[11px] text-mono flex items-center justify-center gap-1"
                    >
                      <Pencil className="size-3" /> Edit
                    </button>
                    <button
                      onClick={() => setDialog({ mode: "photos", target: p, open: true })}
                      className="h-8 px-2 rounded-md bg-panel hover:bg-background text-[11px] text-mono flex items-center justify-center gap-1"
                    >
                      <ImagePlus className="size-3" /> Add
                    </button>
                    <button
                      onClick={() => setRemoving(p)}
                      className="h-8 px-2 rounded-md bg-panel hover:bg-background text-[11px] text-mono flex items-center justify-center gap-1 text-destructive"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <EnrollPersonDialog
        open={dialog.open}
        onOpenChange={(o) => setDialog(o ? (dialog as never) : { mode: "add", open: false })}
        mode={dialog.open ? dialog.mode : "add"}
        target={dialog.open ? dialog.target : null}
      />

      <AlertDialog open={Boolean(removing)} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove enrollment?</AlertDialogTitle>
            <AlertDialogDescription>
              All photos and recognition history for {removing?.name} will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <Trash2 className="size-3.5" /> Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
