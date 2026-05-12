import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import type { Socket } from "socket.io-client";
import { disconnectSocket, getSocket } from "@/lib/socket";
import { useAuth } from "./useAuth";
import type { Detection, IncidentDetection, IncidentLoggedEvent } from "@/types/api";

type FaceEvent = { streamId: string; detections: Detection[] };
type IncidentEvent = { streamId: string; incidents: IncidentDetection[] };

type DetectionListener = (ev: { detections: Detection[]; incidents: IncidentDetection[]; t: number }) => void;
type IncidentLogListener = (ev: IncidentLoggedEvent) => void;
type AgentStatusListener = (ev: { streamId?: string; message: string }) => void;

type SocketContextValue = {
  socket: Socket | null;
  registerDetectionListener: (streamId: string, fn: DetectionListener) => () => void;
  registerIncidentLogListener: (fn: IncidentLogListener) => () => void;
  registerAgentStatusListener: (fn: AgentStatusListener) => () => void;
};

const SocketContext = createContext<SocketContextValue | null>(null);

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { token, logout } = useAuth();

  const detectionListeners = useRef(new Map<string, Set<DetectionListener>>());
  const incidentLogListeners = useRef(new Set<IncidentLogListener>());
  const agentStatusListeners = useRef(new Set<AgentStatusListener>());

  const latestDetections = useRef(new Map<string, Detection[]>());
  const latestIncidents = useRef(new Map<string, IncidentDetection[]>());

  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = getSocket(token);
    socketRef.current = socket;
    if (!socket) return;

    const onFace = (ev: FaceEvent) => {
      latestDetections.current.set(ev.streamId, ev.detections || []);
      const incidents = latestIncidents.current.get(ev.streamId) || [];
      const listeners = detectionListeners.current.get(ev.streamId);
      if (listeners) {
        listeners.forEach((fn) => fn({ detections: ev.detections || [], incidents, t: Date.now() }));
      }
    };
    const onIncident = (ev: IncidentEvent) => {
      latestIncidents.current.set(ev.streamId, ev.incidents || []);
      const detections = latestDetections.current.get(ev.streamId) || [];
      const listeners = detectionListeners.current.get(ev.streamId);
      if (listeners) {
        listeners.forEach((fn) => fn({ detections, incidents: ev.incidents || [], t: Date.now() }));
      }
    };
    const onIncidentLogged = (ev: IncidentLoggedEvent) => {
      incidentLogListeners.current.forEach((fn) => fn(ev));
    };
    const onAgentStatus = (ev: { streamId?: string; message: string }) => {
      agentStatusListeners.current.forEach((fn) => fn(ev));
    };
    const onConnectError = (err: Error) => {
      if (/unauthorized/i.test(err.message || "")) logout();
    };

    socket.on("face_detections", onFace);
    socket.on("incident_detections", onIncident);
    socket.on("incident_logged", onIncidentLogged);
    socket.on("agent_status", onAgentStatus);
    socket.on("connect_error", onConnectError);

    return () => {
      socket.off("face_detections", onFace);
      socket.off("incident_detections", onIncident);
      socket.off("incident_logged", onIncidentLogged);
      socket.off("agent_status", onAgentStatus);
      socket.off("connect_error", onConnectError);
    };
  }, [token, logout]);

  useEffect(() => {
    return () => {
      if (!token) disconnectSocket();
    };
  }, [token]);

  const value = useMemo<SocketContextValue>(
    () => ({
      get socket() {
        return socketRef.current;
      },
      registerDetectionListener(streamId, fn) {
        let set = detectionListeners.current.get(streamId);
        if (!set) {
          set = new Set();
          detectionListeners.current.set(streamId, set);
        }
        set.add(fn);
        return () => {
          set?.delete(fn);
          if (set && set.size === 0) detectionListeners.current.delete(streamId);
        };
      },
      registerIncidentLogListener(fn) {
        incidentLogListeners.current.add(fn);
        return () => {
          incidentLogListeners.current.delete(fn);
        };
      },
      registerAgentStatusListener(fn) {
        agentStatusListeners.current.add(fn);
        return () => {
          agentStatusListeners.current.delete(fn);
        };
      },
    }),
    [],
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error("useSocket must be used within SocketProvider");
  return ctx;
}

export function useDetectionStream(streamId: string | null | undefined, fn: DetectionListener) {
  const ctx = useSocket();
  useEffect(() => {
    if (!streamId) return;
    return ctx.registerDetectionListener(streamId, fn);
  }, [ctx, streamId, fn]);
}

export function useIncidentLogStream(fn: IncidentLogListener) {
  const ctx = useSocket();
  useEffect(() => ctx.registerIncidentLogListener(fn), [ctx, fn]);
}

export function useAgentStatusStream(fn: AgentStatusListener) {
  const ctx = useSocket();
  useEffect(() => ctx.registerAgentStatusListener(fn), [ctx, fn]);
}
