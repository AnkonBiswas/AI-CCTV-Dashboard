const DEFAULT_HOST = (() => {
  if (typeof window === "undefined") return "127.0.0.1";
  return window.location.hostname || "127.0.0.1";
})();

const envBase = import.meta.env.VITE_API_URL as string | undefined;
export const API_BASE =
  envBase && envBase.length > 0
    ? envBase.replace(/\/$/, "")
    : `${typeof window !== "undefined" ? window.location.protocol : "http:"}//${DEFAULT_HOST}:3000`;

export const WEBRTC_BASE = (() => {
  const envWhep = import.meta.env.VITE_WEBRTC_URL as string | undefined;
  if (envWhep) return envWhep.replace(/\/$/, "");
  const proto = typeof window !== "undefined" ? window.location.protocol : "http:";
  return `${proto}//${DEFAULT_HOST}:8889`;
})();

const TOKEN_KEY = "cctv_token";
let unauthorizedHandler: (() => void) | null = null;

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function registerUnauthorizedHandler(fn: () => void) {
  unauthorizedHandler = fn;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

type RequestOpts = Omit<RequestInit, "body"> & { body?: unknown; query?: Record<string, string | number | boolean | undefined | null> };

export async function api<T = unknown>(path: string, opts: RequestOpts = {}): Promise<T> {
  const headers = new Headers(opts.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let body: BodyInit | undefined;
  if (opts.body !== undefined && opts.body !== null) {
    if (opts.body instanceof FormData || typeof opts.body === "string") {
      body = opts.body as BodyInit;
    } else {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(opts.body);
    }
  }

  let url = `${API_BASE}${path}`;
  if (opts.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) {
      if (v === undefined || v === null) continue;
      params.set(k, String(v));
    }
    const q = params.toString();
    if (q) url += (url.includes("?") ? "&" : "?") + q;
  }

  const res = await fetch(url, { ...opts, headers, body });
  if (res.status === 401) {
    unauthorizedHandler?.();
    throw new ApiError(401, "Unauthorized", null);
  }
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!res.ok) {
    const msg =
      (parsed && typeof parsed === "object" && "error" in parsed && typeof parsed.error === "string"
        ? parsed.error
        : null) || res.statusText || `HTTP ${res.status}`;
    throw new ApiError(res.status, msg, parsed);
  }
  return parsed as T;
}

export function buildAssetUrl(path: string): string {
  const token = getToken();
  const url = `${API_BASE}${path}`;
  if (!token) return url;
  return url + (url.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token);
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("read error"));
    reader.readAsDataURL(file);
  });
}
