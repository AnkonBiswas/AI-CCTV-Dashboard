import { io, Socket } from "socket.io-client";
import { API_BASE } from "./api";

let current: Socket | null = null;
let currentToken: string | null = null;

export function getSocket(token: string | null): Socket | null {
  if (!token) {
    if (current) {
      current.disconnect();
      current = null;
      currentToken = null;
    }
    return null;
  }
  if (current && currentToken === token && current.connected) return current;
  if (current) {
    current.disconnect();
    current = null;
  }
  current = io(API_BASE, {
    auth: { token },
    transports: ["websocket", "polling"],
    reconnection: true,
  });
  currentToken = token;
  return current;
}

export function disconnectSocket() {
  if (current) current.disconnect();
  current = null;
  currentToken = null;
}
