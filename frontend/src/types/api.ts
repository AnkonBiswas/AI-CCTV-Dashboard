export type User = { id: number; username: string };

export type AuthResponse = { token: string; user: User };

export type Camera = {
  streamId: string;
  cameraName: string;
  rtspUrl: string;
  pathName: string;
  hlsUrl: string;
  lat?: number | null;
  lng?: number | null;
};

export type AddCameraResponse = {
  streamId: string;
  cameraName: string;
  hlsUrl: string;
  streamKey: string;
  rtspUrl: string;
  agentStarted: boolean;
};

export type EnrollmentType = "standard" | "staff" | "vip" | "visitor" | "threat";

export type Enrollment = {
  name: string;
  type: EnrollmentType;
  notes?: string | null;
  photoCount: number;
  file?: string | null;
};

export type Feature = {
  name: string;
  enabled: boolean;
  description?: string | null;
  updated_at?: string | null;
};

export type Incident = {
  id: number;
  streamId: string;
  cameraName: string;
  type: "fire" | "smoke" | "face" | "person";
  name?: string | null;
  confidence: number;
  bbox: { x: number; y: number; w: number; h: number } | null;
  snapshot?: string | null;
  createdAt: string;
};

export type AnalyticsCounts = { people: number; recognized: number; events: number; alerts: number };
export type Analytics = {
  period: string;
  counts: AnalyticsCounts;
  deltas: { people: number; recognized: number; events: number; alerts: number };
};

export type AnalyticsCharts = {
  days: number;
  total: number;
  heatmap: { dow: number; hour: number; n: number }[];
  byType: { type: string; n: number }[];
  byCamera: { camera: string; n: number }[];
  byPerson: { name: string; n: number }[];
  daily: { day: string; n: number; alerts: number }[];
};

export type DaywiseRow = {
  day: string;
  name: string;
  nameKey: string;
  n: number;
  firstSeen: string;
  lastSeen: string;
  cameras: string[];
};

export type AnalyticsDaywise = { days: number; rows: DaywiseRow[] };

export type PersonActivityTimelineEntry = {
  id: number;
  cameraName: string;
  confidence: number;
  snapshot?: string | null;
  createdAt: string;
  lat?: number | null;
  lng?: number | null;
};

export type PersonActivity = {
  name: string;
  displayName: string;
  type: EnrollmentType;
  notes?: string | null;
  days: number;
  date?: string | null;
  summary: {
    total: number;
    firstSeen: string | null;
    lastSeen: string | null;
    distinctCameras: number;
    distinctDays: number;
  };
  byCamera: { camera: string; n: number }[];
  byHour: number[];
  byDay: { day: string; n: number }[];
  timeline: PersonActivityTimelineEntry[];
};

export type SystemHealth = {
  uptimeMs: number;
  mediamtx: boolean;
  aiWorker: boolean;
  storage: { total: number; free: number; used: number };
  cameras: { live: number; connecting: number; offline: number };
};

export type Detection = {
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
  label: "person" | "face";
  name?: string | null;
  personType?: EnrollmentType | null;
};

export type IncidentDetection = {
  type: "fire" | "smoke";
  confidence: number;
  box: [number, number, number, number];
};

export type IncidentLoggedEvent = {
  streamId: string;
  cameraName: string;
  type: Incident["type"];
  name?: string | null;
  confidence?: number;
  snapshot?: string | null;
  createdAt: string;
};
