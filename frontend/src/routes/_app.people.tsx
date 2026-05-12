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
import { useAuth } from "@/hooks/useAuth";
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
  const { canWrite } = useAuth();
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
          {canWrite && (
            <Button onClick={() => setDialog({ mode: "add", open: true })}>
              <Plus className="size-3.5" /> Enroll person
            </Button>
          )}
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
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 p-4">
            {filtered.map((p) => (
              <PersonCard
                key={p.name}
                person={p}
                canWrite={canWrite}
                onEdit={() => setDialog({ mode: "edit", target: p, open: true })}
                onAddPhotos={() => setDialog({ mode: "photos", target: p, open: true })}
                onRemove={() => setRemoving(p)}
              />
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

function PersonCard({
  person,
  canWrite,
  onEdit,
  onAddPhotos,
  onRemove,
}: {
  person: Enrollment;
  canWrite: boolean;
  onEdit: () => void;
  onAddPhotos: () => void;
  onRemove: () => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const initials = (person.name[0] || "?").toUpperCase();

  return (
    <div className="rounded-xl border border-border bg-panel overflow-hidden flex flex-col group">
      <div className="relative aspect-[4/5] bg-panel-elevated overflow-hidden">
        {imgFailed ? (
          <div className="absolute inset-0 grid place-items-center">
            <Avatar initials={initials} color="oklch(0.6 0.06 250)" size={64} />
          </div>
        ) : (
          <img
            src={buildAssetUrl(`/enrollment/${encodeURIComponent(person.name)}/image`)}
            alt={person.name}
            className="absolute inset-0 w-full h-full object-cover"
            onError={() => setImgFailed(true)}
          />
        )}

        <div className="absolute top-2 right-2">
          <span
            className={`text-[9px] text-mono uppercase tracking-wider px-1.5 py-0.5 border rounded backdrop-blur ${
              TYPE_TONES[person.type] ?? TYPE_TONES.standard
            }`}
          >
            {person.type}
          </span>
        </div>

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/95 via-background/70 to-transparent p-3">
          <div className="text-sm font-semibold truncate">{person.name}</div>
          <div className="text-[10px] text-mono text-muted-foreground">
            {person.photoCount} {person.photoCount === 1 ? "photo" : "photos"}
          </div>
        </div>
      </div>

      <div className="p-2 flex items-center gap-1">
        <Link
          to="/person/$name"
          params={{ name: person.name }}
          className="flex-1 h-8 px-2 rounded-md bg-panel-elevated hover:bg-background text-[11px] text-mono flex items-center justify-center gap-1.5"
          title="View activity"
        >
          <UserSearch className="size-3" /> Activity
        </Link>
        {canWrite && (
          <>
            <button
              onClick={onEdit}
              className="size-8 rounded-md bg-panel-elevated hover:bg-background grid place-items-center text-muted-foreground hover:text-foreground"
              title="Edit category"
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              onClick={onAddPhotos}
              className="size-8 rounded-md bg-panel-elevated hover:bg-background grid place-items-center text-muted-foreground hover:text-foreground"
              title="Add photos"
            >
              <ImagePlus className="size-3.5" />
            </button>
            <button
              onClick={onRemove}
              className="size-8 rounded-md bg-panel-elevated hover:bg-destructive/15 grid place-items-center text-muted-foreground hover:text-destructive"
              title="Remove"
            >
              <Trash2 className="size-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
