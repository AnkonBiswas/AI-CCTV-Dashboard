import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Trash2, Video } from "lucide-react";
import { toast } from "sonner";
import { EmptyHint } from "@/components/AppShell";
import { CameraTile } from "@/components/CameraTile";
import { LeafletMap } from "@/components/LeafletMap";
import { AddCameraDialog } from "@/components/AddCameraDialog";
import { Button } from "@/components/ui/button";
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
import { useCameras, useRemoveCamera } from "@/hooks/queries";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_app/cameras")({
  staticData: { title: "Cameras", subtitle: "Live feeds and ingest configuration" },
  component: CamerasPage,
});

function CamerasPage() {
  const cameras = useCameras();
  const remove = useRemoveCamera();
  const { canWrite } = useAuth();
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);

  const cams = cameras.data ?? [];
  const geocoded = cams.filter((c) => c.lat != null && c.lng != null);

  async function confirmRemove() {
    if (!removing) return;
    try {
      await remove.mutateAsync(removing.id);
      toast.success(`Removed ${removing.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-mono text-[10px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-success animate-pulse" />
          {cams.length} {cams.length === 1 ? "feed" : "feeds"}
        </div>
        {canWrite && (
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="size-3.5" /> Add camera
          </Button>
        )}
      </div>

      {cams.length === 0 ? (
        <div className="rounded-xl border border-border bg-panel py-12">
          <EmptyHint
            icon={Video}
            title="No cameras yet"
            description="Click 'Add camera' and paste an RTSP URL to start monitoring."
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {cams.map((c) => (
            <CameraTile
              key={c.streamId}
              streamId={c.streamId}
              cameraName={c.cameraName}
              hlsUrl={c.hlsUrl}
              pathName={c.pathName}
              showRemove={canWrite}
              onRemove={
                canWrite ? () => setRemoving({ id: c.streamId, name: c.cameraName }) : undefined
              }
            />
          ))}
        </div>
      )}

      {geocoded.length > 0 && (
        <div className="bg-panel border border-border rounded-xl p-1">
          <div className="px-3 py-2 text-[10px] uppercase tracking-widest text-mono text-muted-foreground">
            Map
          </div>
          <LeafletMap
            mode="markers"
            markers={geocoded.map((c) => ({
              id: c.streamId,
              lat: Number(c.lat),
              lng: Number(c.lng),
              popup: `<strong>${escapeHtml(c.cameraName)}</strong><br/><span style="font-family:JetBrains Mono,ui-monospace,monospace;font-size:11px">${escapeHtml(c.rtspUrl)}</span>`,
            }))}
            className="h-[420px] rounded-md"
          />
        </div>
      )}

      <AddCameraDialog open={addOpen} onOpenChange={setAddOpen} />

      <AlertDialog open={Boolean(removing)} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove camera?</AlertDialogTitle>
            <AlertDialogDescription>
              "{removing?.name}" will be removed from MediaMTX and stop generating events.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemove}
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
