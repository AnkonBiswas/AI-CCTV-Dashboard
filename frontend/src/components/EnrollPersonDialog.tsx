import { useEffect, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEnrollPerson, useUpdateEnrollment } from "@/hooks/queries";
import { fileToDataUrl } from "@/lib/api";
import type { Enrollment, EnrollmentType } from "@/types/api";

type Mode = "add" | "edit" | "photos";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: Mode;
  target?: Enrollment | null;
};

const TYPES: EnrollmentType[] = ["standard", "staff", "vip", "visitor", "threat"];

export function EnrollPersonDialog({ open, onOpenChange, mode, target }: Props) {
  const [name, setName] = useState("");
  const [type, setType] = useState<EnrollmentType>("standard");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const enroll = useEnrollPerson();
  const update = useUpdateEnrollment();

  useEffect(() => {
    if (!open) return;
    setError(null);
    setFiles([]);
    if (mode === "edit" && target) {
      setName(target.name);
      setType(target.type);
    } else if (mode === "photos" && target) {
      setName(target.name);
      setType(target.type);
    } else {
      setName("");
      setType("standard");
    }
  }, [open, mode, target]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (mode === "edit" && target) {
        await update.mutateAsync({ name: target.name, type });
        toast.success(`Updated ${target.name}`);
      } else {
        if (mode === "add" && !name.trim()) {
          setError("Name is required");
          return;
        }
        if (!files.length && mode !== "edit") {
          setError("Add at least one photo");
          return;
        }
        const imagesBase64 = await Promise.all(files.map((f) => fileToDataUrl(f)));
        await enroll.mutateAsync({
          name: name.trim(),
          imagesBase64,
          type: mode === "add" ? type : undefined,
        });
        toast.success(`${mode === "photos" ? "Added photos" : "Enrolled"} ${name.trim()}`);
      }
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Operation failed");
    }
  }

  const title =
    mode === "add" ? "Enroll person" : mode === "edit" ? "Edit person" : "Add more photos";
  const description =
    mode === "add"
      ? "Upload one or more photos. The AI worker will train as soon as the enrollment lands."
      : mode === "edit"
        ? "Change the category. Photos are kept."
        : "Add more sample photos for this person.";

  const busy = enroll.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="p-name">Name</Label>
            <Input
              id="p-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={mode !== "add"}
              required
            />
          </div>
          {mode !== "photos" && (
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={type} onValueChange={(v) => setType(v as EnrollmentType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {mode !== "edit" && (
            <div className="space-y-2">
              <Label htmlFor="p-files">Photos</Label>
              <Input
                id="p-files"
                type="file"
                accept="image/jpeg,image/png"
                multiple
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              />
              {files.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {files.map((f, i) => (
                    <span
                      key={i}
                      className="text-[10px] text-mono bg-panel-elevated border border-border rounded px-1.5 py-0.5"
                    >
                      {f.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          {error && (
            <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
              {error}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : title}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
