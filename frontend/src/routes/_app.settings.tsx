import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useFeatures, useUpdateFeature } from "@/hooks/queries";

export const Route = createFileRoute("/_app/settings")({
  staticData: { title: "Settings", subtitle: "Detection features and operator preferences" },
  component: SettingsPage,
});

function SettingsPage() {
  const features = useFeatures();
  const update = useUpdateFeature();

  async function toggle(name: string, enabled: boolean) {
    try {
      await update.mutateAsync({ name, enabled });
      toast.success(`${name.replace(/_/g, " ")} ${enabled ? "enabled" : "disabled"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update");
    }
  }

  return (
    <div className="p-8 space-y-6 max-w-2xl">
      <div className="bg-panel border border-border rounded-xl">
        <div className="p-5 border-b border-border">
          <div className="text-sm font-semibold">Detection features</div>
          <div className="text-xs text-muted-foreground mt-1">
            Disabling a feature stops the backend from logging its events. Detections still happen
            on screen but won't be persisted.
          </div>
        </div>
        <div className="divide-y divide-border">
          {(features.data ?? []).length === 0 && (
            <div className="p-6 text-xs text-muted-foreground text-center">
              {features.isLoading ? "Loading…" : "No features available."}
            </div>
          )}
          {(features.data ?? []).map((f) => (
            <div key={f.name} className="p-5 flex items-center justify-between gap-4">
              <div>
                <Label htmlFor={`f-${f.name}`} className="text-sm">
                  {f.name.replace(/_/g, " ")}
                </Label>
                {f.description && (
                  <div className="text-xs text-muted-foreground mt-1">{f.description}</div>
                )}
              </div>
              <Switch
                id={`f-${f.name}`}
                checked={f.enabled}
                onCheckedChange={(v) => toggle(f.name, v)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
