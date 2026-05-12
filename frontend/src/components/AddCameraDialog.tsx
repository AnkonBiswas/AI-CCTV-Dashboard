import { useState } from "react";
import { useAddCamera } from "@/hooks/queries";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AgentInstructionsDialog } from "@/components/AgentInstructionsDialog";
import { MapPin } from "lucide-react";
import type { AddCameraResponse } from "@/types/api";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AddCameraDialog({ open, onOpenChange }: Props) {
  const [cameraName, setCameraName] = useState("");
  const [rtspUrl, setRtspUrl] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [agent, setAgent] = useState<AddCameraResponse | null>(null);
  const add = useAddCamera();

  function useMyLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
      },
      () => toast.error("Could not get location"),
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await add.mutateAsync({
        cameraName: cameraName.trim(),
        rtspUrl: rtspUrl.trim(),
        lat: lat ? Number(lat) : null,
        lng: lng ? Number(lng) : null,
      });
      toast.success(`Camera "${res.cameraName}" added`);
      setCameraName("");
      setRtspUrl("");
      setLat("");
      setLng("");
      setAgent(res);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add camera");
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add camera</DialogTitle>
            <DialogDescription>
              Register a new RTSP source. The backend will spawn a local ingest agent.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cam-name">Camera name</Label>
              <Input
                id="cam-name"
                placeholder="Main Entrance"
                value={cameraName}
                onChange={(e) => setCameraName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cam-rtsp">RTSP URL</Label>
              <Input
                id="cam-rtsp"
                placeholder="rtsp://192.168.x.x:554/stream"
                value={rtspUrl}
                onChange={(e) => setRtspUrl(e.target.value)}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="cam-lat">Latitude</Label>
                <Input
                  id="cam-lat"
                  type="number"
                  step="0.000001"
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cam-lng">Longitude</Label>
                <Input
                  id="cam-lng"
                  type="number"
                  step="0.000001"
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                />
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={useMyLocation}
              className="w-full"
              size="sm"
            >
              <MapPin className="size-3.5" /> Use my location
            </Button>
            {error && (
              <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
                {error}
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={add.isPending}>
                {add.isPending ? "Adding…" : "Add camera"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AgentInstructionsDialog
        info={agent}
        open={Boolean(agent)}
        onOpenChange={(o) => {
          if (!o) setAgent(null);
        }}
      />
    </>
  );
}
