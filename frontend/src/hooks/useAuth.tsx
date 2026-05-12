import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, getToken, registerUnauthorizedHandler, setToken } from "@/lib/api";
import type { AuthResponse, User } from "@/types/api";

export type AuthState = {
  token: string | null;
  user: User | null;
  ready: boolean;
  login: (username: string, password: string) => Promise<void>;
  signup: (username: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

function decodeUser(token: string): User | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1])) as Partial<User>;
    if (typeof payload.id === "number" && typeof payload.username === "string") {
      return { id: payload.id, username: payload.username };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTok] = useState<string | null>(() => getToken());
  const [user, setUser] = useState<User | null>(() => {
    const t = getToken();
    return t ? decodeUser(t) : null;
  });
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    setToken(null);
    setTok(null);
    setUser(null);
  }, []);

  useEffect(() => {
    registerUnauthorizedHandler(() => {
      setToken(null);
      setTok(null);
      setUser(null);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function probe() {
      if (!token) {
        setReady(true);
        return;
      }
      try {
        const me = await api<User>("/me");
        if (!cancelled) setUser(me);
      } catch {
        if (!cancelled) {
          setToken(null);
          setTok(null);
          setUser(null);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    }
    probe();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api<AuthResponse>("/login", {
      method: "POST",
      body: { username, password },
    });
    setToken(res.token);
    setTok(res.token);
    setUser(res.user);
  }, []);

  const signup = useCallback(async (username: string, password: string) => {
    const res = await api<AuthResponse>("/signup", {
      method: "POST",
      body: { username, password },
    });
    setToken(res.token);
    setTok(res.token);
    setUser(res.user);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ token, user, ready, login, signup, logout }),
    [token, user, ready, login, signup, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
