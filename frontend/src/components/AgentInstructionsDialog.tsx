import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAgentStatusStream } from "@/hooks/useSocket";
import type { AddCameraResponse } from "@/types/api";
import { API_BASE } from "@/lib/api";

type Props = {
  info: AddCameraResponse | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AgentInstructionsDialog({ info, open, onOpenChange }: Props) {
  const [status, setStatus] = useState<string | null>(null);

  useAgentStatusStream((ev) => {
    setStatus(ev.message);
  });

  useEffect(() => {
    if (!open) setStatus(null);
  }, [open]);

  if (!info) return null;

  const agentCmd = `python agent/agent.py ${API_BASE} ${info.streamKey} ${info.rtspUrl}`;
  const ffmpegCmd = `ffmpeg -rtsp_transport tcp -i ${info.rtspUrl} -c copy -f rtsp rtsp://127.0.0.1:8554/${info.streamKey}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Camera registered</DialogTitle>
          <DialogDescription>
            {info.agentStarted
              ? "A local agent is bridging this stream into MediaMTX. You can ignore the instructions below unless you want to push from another machine."
              : "Run one of the commands below on a host that can reach the camera to start pushing into MediaMTX."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-xs">
          <CodeBlock label="Local agent" code={agentCmd} />
          <CodeBlock label="FFmpeg (raw)" code={ffmpegCmd} />
          {status && (
            <div className="text-mono text-[11px] text-muted-foreground bg-panel-elevated border border-border rounded-md px-3 py-2">
              {status}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CodeBlock({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(code).then(
      () => {
        setCopied(true);
        toast.success(`${label} copied`);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => toast.error("Copy failed"),
    );
  }
  return (
    <div className="rounded-md border border-border bg-panel-elevated overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 text-[10px] text-mono uppercase tracking-wider text-muted-foreground border-b border-border">
        {label}
        <button onClick={copy} className="text-foreground hover:text-primary inline-flex items-center gap-1">
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="px-3 py-2 text-mono text-[11px] whitespace-pre-wrap break-all">{code}</pre>
    </div>
  );
}
