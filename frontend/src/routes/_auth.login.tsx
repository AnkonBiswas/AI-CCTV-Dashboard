import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";

const searchSchema = z.object({ redirect: z.string().optional() });

export const Route = createFileRoute("/_auth/login")({
  validateSearch: searchSchema,
  component: LoginPage,
});

function LoginPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      const dest = search.redirect ?? "/";
      navigate({ to: dest });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Sign in</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Access your surveillance operations center.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="username">Username</Label>
        <Input
          id="username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      {error && (
        <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
          {error}
        </div>
      )}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Signing in…" : "Sign in"}
      </Button>
      <div className="text-xs text-muted-foreground text-center">
        Don't have an account?{" "}
        <Link to="/signup" className="text-primary hover:underline">
          Create one
        </Link>
      </div>
    </form>
  );
}
