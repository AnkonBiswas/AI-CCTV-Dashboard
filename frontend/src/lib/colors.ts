import type { Detection } from "@/types/api";

export const DETECTION_COLORS = {
  recognized: "#10b981",
  face: "#3b82f6",
  person: "#f59e0b",
  incident: "#ef4444",
} as const;

const PERSON_TYPE_COLORS: Record<string, string> = {
  threat: "#ef4444",
  vip: "#f59e0b",
  staff: "#3b82f6",
  visitor: "#a1a1aa",
  standard: "#10b981",
};

export function colorForDetection(d: Detection): string {
  if (d.name) {
    return PERSON_TYPE_COLORS[d.personType ?? "standard"] ?? DETECTION_COLORS.recognized;
  }
  return d.label === "person" ? DETECTION_COLORS.person : DETECTION_COLORS.face;
}
