import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";

export const Route = createFileRoute("/_auth/signup")({
  component: SignupPage,
});

function SignupPage() {
  const navigate = useNavigate();
  const { signup } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signup(username.trim(), password);
      navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Signup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Create account</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Provision a new operator. Usernames must be 3–32 chars (letters, digits, _ or -).
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
          minLength={3}
          maxLength={32}
          pattern="[A-Za-z0-9_\-]+"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
        />
      </div>
      {error && (
        <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
          {error}
        </div>
      )}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Creating…" : "Create account"}
      </Button>
      <div className="text-xs text-muted-foreground text-center">
        Already have an account?{" "}
        <Link to="/login" className="text-primary hover:underline">
          Sign in
        </Link>
      </div>
    </form>
  );
}
