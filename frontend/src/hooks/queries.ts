import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  AddCameraResponse,
  Analytics,
  AnalyticsCharts,
  AnalyticsDaywise,
  Camera,
  Enrollment,
  EnrollmentType,
  Feature,
  Incident,
  PersonActivity,
} from "@/types/api";

export function useCameras() {
  return useQuery({
    queryKey: ["cameras"],
    queryFn: () => api<Camera[]>("/cameras"),
    refetchInterval: 30_000,
  });
}

export function useEnrollments() {
  return useQuery({
    queryKey: ["enrollments"],
    queryFn: () => api<Enrollment[]>("/enrollments"),
  });
}

export function useFeatures() {
  return useQuery({
    queryKey: ["features"],
    queryFn: () => api<Feature[]>("/features"),
  });
}

export function useIncidents(params?: {
  limit?: number;
  type?: string;
  streamId?: string;
  since?: string;
  incidentsOnly?: boolean;
  refetchInterval?: number;
}) {
  return useQuery({
    queryKey: ["incidents", params ?? {}],
    queryFn: () =>
      api<Incident[]>("/incidents", {
        query: {
          limit: params?.limit,
          type: params?.type,
          streamId: params?.streamId,
          since: params?.since,
          incidentsOnly: params?.incidentsOnly ? "true" : undefined,
        },
      }),
    refetchInterval: params?.refetchInterval,
  });
}

export function useAnalytics(period: "today" | "24h" | "7d" = "today") {
  return useQuery({
    queryKey: ["analytics", period],
    queryFn: () => api<Analytics>("/analytics", { query: { period } }),
    refetchInterval: 60_000,
  });
}

export function useAnalyticsCharts(days: number = 7) {
  return useQuery({
    queryKey: ["analytics-charts", days],
    queryFn: () => api<AnalyticsCharts>("/analytics-charts", { query: { days } }),
  });
}

export function useAnalyticsDaywise(days: number = 7) {
  return useQuery({
    queryKey: ["analytics-daywise", days],
    queryFn: () => api<AnalyticsDaywise>("/analytics-daywise", { query: { days } }),
  });
}

export function usePersonActivity(name: string | undefined, opts: { date?: string; days?: number } = {}) {
  return useQuery({
    queryKey: ["person-activity", name, opts.date ?? null, opts.days ?? 30],
    queryFn: () =>
      api<PersonActivity>(`/person/${encodeURIComponent(name!)}/activity`, {
        query: { date: opts.date, days: opts.days ?? 30 },
      }),
    enabled: Boolean(name),
  });
}

export function useAddCamera() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { rtspUrl: string; cameraName: string; lat?: number | null; lng?: number | null }) =>
      api<AddCameraResponse>("/add-camera", { method: "POST", body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["cameras"] });
    },
  });
}

export function useRemoveCamera() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/camera/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["cameras"] });
    },
  });
}

export function useUpdateCameraLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, lat, lng }: { id: string; lat: number | null; lng: number | null }) =>
      api(`/camera/${id}`, { method: "PUT", body: { lat, lng } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["cameras"] });
    },
  });
}

export function useEnrollPerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; imagesBase64: string[]; type?: EnrollmentType }) =>
      api("/enroll", { method: "POST", body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["enrollments"] });
    },
  });
}

export function useUpdateEnrollment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      name,
      type,
      notes,
    }: {
      name: string;
      type?: EnrollmentType;
      notes?: string;
    }) =>
      api(`/enrollment/${encodeURIComponent(name)}`, {
        method: "PUT",
        body: { type, notes },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["enrollments"] });
    },
  });
}

export function useDeleteEnrollment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api(`/enrollment/${encodeURIComponent(name)}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["enrollments"] });
    },
  });
}

export function useUpdateFeature() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      api(`/features/${encodeURIComponent(name)}`, {
        method: "PUT",
        body: { enabled },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["features"] });
    },
  });
}
