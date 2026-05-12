import { createFileRoute } from "@tanstack/react-router";
import { Info, Shield } from "lucide-react";
import { Avatar, StatCard } from "@/components/AppShell";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_app/users")({
  staticData: { title: "User Management", subtitle: "Operator accounts and roles" },
  component: UsersPage,
});

const ROLES = [
  {
    name: "Admin",
    description: "Full access including settings, enrollment, and user management.",
  },
  {
    name: "Supervisor",
    description: "Manage cameras, view all incidents, run reports.",
  },
  {
    name: "Operator",
    description: "Monitor live feeds and acknowledge incidents.",
  },
];

function UsersPage() {
  const { user } = useAuth();

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start gap-3 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-xs text-warning">
        <Info className="size-4 mt-0.5 shrink-0" />
        <div>
          The backend does not currently expose a user-listing endpoint. The card below shows the
          signed-in account; full user administration will land once the backend ships{" "}
          <code className="bg-panel-elevated border border-border rounded px-1 py-0.5">/users</code>
          .
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Signed in" value={user?.username ?? "—"} />
        <StatCard label="Role" value="Admin" />
        <StatCard label="Total users" value="—" />
        <StatCard label="Failed logins (24h)" value="—" />
      </div>

      <div className="grid grid-cols-3 gap-4">
        {ROLES.map((r) => (
          <div key={r.name} className="bg-panel border border-border rounded-xl p-5">
            <div className="size-9 rounded-md bg-primary/15 text-primary grid place-items-center">
              <Shield className="size-4" />
            </div>
            <div className="mt-3 text-sm font-semibold">{r.name}</div>
            <div className="mt-1 text-xs text-muted-foreground">{r.description}</div>
          </div>
        ))}
      </div>

      <div className="bg-panel border border-border rounded-xl">
        <div className="p-4 border-b border-border text-[10px] uppercase tracking-widest text-mono text-muted-foreground">
          Current operator
        </div>
        <div className="p-5 flex items-center gap-4">
          <Avatar
            initials={(user?.username?.[0] || "?").toUpperCase()}
            color="oklch(0.7 0.15 200)"
            size={48}
          />
          <div>
            <div className="text-base font-semibold">{user?.username ?? "Unknown"}</div>
            <div className="text-xs text-muted-foreground text-mono">id #{user?.id ?? "—"}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
