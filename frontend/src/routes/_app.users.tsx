import { useMemo, useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import {
  ShieldCheck,
  ShieldAlert,
  Eye,
  Plus,
  Pencil,
  KeyRound,
  Trash2,
  MoreVertical,
  AlertTriangle,
} from "lucide-react";
import type { ComponentType } from "react";
import { toast } from "sonner";
import { Avatar, StatCard } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import {
  useCreateUser,
  useDeleteUser,
  useFailedLogins,
  useResetUserPassword,
  useUpdateUser,
  useUsers,
} from "@/hooks/queries";
import { ApiError } from "@/lib/api";
import type { ManagedUser, UserRole } from "@/types/api";
import { USER_ROLES } from "@/types/api";

export const Route = createFileRoute("/_app/users")({
  staticData: { title: "User Management", subtitle: "Operator accounts and roles" },
  beforeLoad: ({ context }) => {
    // Admin-only route. Non-admins bounce to the dashboard.
    const role = context.auth?.user?.role;
    if (role && role !== "Admin") {
      throw redirect({ to: "/" });
    }
  },
  component: UsersPage,
});

type Role = {
  name: UserRole;
  icon: ComponentType<{ className?: string }>;
  tone: "primary" | "warning" | "muted";
  description: string;
};

const ROLE_META: Role[] = [
  {
    name: "Admin",
    icon: ShieldCheck,
    tone: "primary",
    description: "Full access. Manage cameras, enrollments, settings, and other users.",
  },
  {
    name: "Moderator",
    icon: ShieldAlert,
    tone: "warning",
    description: "Manage cameras and enrollments, run reports. Cannot manage users.",
  },
  {
    name: "Visitor",
    icon: Eye,
    tone: "muted",
    description: "Read-only access. Watch feeds and browse reports. No write actions.",
  },
];

const TONE_STYLES: Record<Role["tone"], string> = {
  primary: "bg-primary/15 text-primary border-primary/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  muted: "bg-muted text-muted-foreground border-border",
};

const ROLE_TONE: Record<UserRole, Role["tone"]> = {
  Admin: "primary",
  Moderator: "warning",
  Visitor: "muted",
};

function UsersPage() {
  const { user: me, isAdmin } = useAuth();
  const users = useUsers(isAdmin);
  const failed = useFailedLogins(24, isAdmin);
  const del = useDeleteUser();

  const [invite, setInvite] = useState(false);
  const [edit, setEdit] = useState<ManagedUser | null>(null);
  const [reset, setReset] = useState<ManagedUser | null>(null);
  const [removing, setRemoving] = useState<ManagedUser | null>(null);

  const counts = useMemo(() => {
    const c: Record<UserRole, number> = { Admin: 0, Moderator: 0, Visitor: 0 };
    for (const u of users.data ?? []) c[u.role] += 1;
    return c;
  }, [users.data]);

  async function confirmDelete() {
    if (!removing) return;
    try {
      await del.mutateAsync(removing.id);
      toast.success(`Removed ${removing.username}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Delete failed");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="p-8 space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total users" value={String(users.data?.length ?? 0)} />
        <StatCard label="Admins" value={String(counts.Admin)} tone="success" />
        <StatCard label="Moderators" value={String(counts.Moderator)} />
        <StatCard
          label="Failed logins (24h)"
          value={String(failed.data?.total ?? 0)}
          tone={(failed.data?.total ?? 0) > 0 ? "warning" : "default"}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {ROLE_META.map((r) => {
          const Icon = r.icon;
          return (
            <div key={r.name} className="bg-panel border border-border rounded-xl p-5">
              <div className="flex items-center gap-3">
                <div
                  className={`size-9 rounded-md grid place-items-center border ${TONE_STYLES[r.tone]}`}
                >
                  <Icon className="size-4" />
                </div>
                <div className="text-sm font-semibold">{r.name}</div>
                <span className="ml-auto text-[10px] text-mono text-muted-foreground">
                  {counts[r.name]}
                </span>
              </div>
              <div className="mt-3 text-xs text-muted-foreground leading-relaxed">
                {r.description}
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-panel border border-border rounded-xl">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Operators</div>
            <div className="text-xs text-muted-foreground">
              {users.isLoading ? "Loading…" : `${users.data?.length ?? 0} accounts`}
            </div>
          </div>
          <Button onClick={() => setInvite(true)}>
            <Plus className="size-3.5" /> Invite user
          </Button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-widest text-mono text-muted-foreground border-b border-border">
              <th className="px-5 py-3 font-medium">User</th>
              <th className="px-5 py-3 font-medium">Role</th>
              <th className="px-5 py-3 font-medium">Created</th>
              <th className="px-5 py-3 font-medium">Last failed login</th>
              <th className="px-5 py-3 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(users.data ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center text-xs text-muted-foreground">
                  {users.isLoading ? "Loading…" : "No users."}
                </td>
              </tr>
            )}
            {(users.data ?? []).map((u) => {
              const isMe = u.id === me?.id;
              return (
                <tr key={u.id} className="hover:bg-panel-elevated transition">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar
                        initials={(u.username[0] || "?").toUpperCase()}
                        color="oklch(0.7 0.15 200)"
                        size={32}
                      />
                      <div>
                        <div className="font-semibold flex items-center gap-2">
                          {u.username}
                          {isMe && (
                            <span className="text-[10px] text-mono uppercase text-muted-foreground">
                              you
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-mono text-muted-foreground">id #{u.id}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`text-[10px] text-mono uppercase px-1.5 py-0.5 border rounded ${TONE_STYLES[ROLE_TONE[u.role]]}`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-mono text-xs text-muted-foreground">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-3 text-mono text-xs text-muted-foreground">
                    {u.lastFailed ? new Date(u.lastFailed).toLocaleString() : "—"}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className="size-7 rounded-md bg-panel-elevated border border-border grid place-items-center hover:bg-panel"
                          aria-label="Actions"
                        >
                          <MoreVertical className="size-3" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onClick={() => setEdit(u)}>
                          <Pencil className="size-3.5" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setReset(u)}>
                          <KeyRound className="size-3.5" /> Reset password
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => setRemoving(u)}
                          disabled={isMe}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="size-3.5" />{" "}
                          {isMe ? "Cannot delete self" : "Remove"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {failed.data && failed.data.recent.length > 0 && (
        <div className="bg-panel border border-border rounded-xl">
          <div className="p-4 border-b border-border flex items-center gap-2">
            <AlertTriangle className="size-3.5 text-warning" />
            <div className="text-sm font-semibold">Recent failed logins (24h)</div>
          </div>
          <div className="divide-y divide-border max-h-72 overflow-y-auto">
            {failed.data.recent.map((row, i) => (
              <div key={i} className="px-4 py-2 flex items-center justify-between text-xs">
                <div className="flex items-center gap-3">
                  <span className="text-mono">{row.username ?? "—"}</span>
                  <span className="text-mono text-muted-foreground">{row.ip ?? "—"}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-mono uppercase bg-destructive/10 text-destructive border border-destructive/30 rounded px-1.5 py-0.5">
                    {row.reason ?? "fail"}
                  </span>
                  <span className="text-mono text-muted-foreground">
                    {new Date(row.occurred_at).toLocaleString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <InviteDialog open={invite} onOpenChange={setInvite} />
      <EditDialog target={edit} onOpenChange={(o) => !o && setEdit(null)} />
      <ResetPasswordDialog target={reset} onOpenChange={(o) => !o && setReset(null)} />

      <AlertDialog open={Boolean(removing)} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove user?</AlertDialogTitle>
            <AlertDialogDescription>
              Deleting {removing?.username} also removes their cameras, enrollments, feature
              toggles, and incident history. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <Trash2 className="size-3.5" /> Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const create = useCreateUser();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("Visitor");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setUsername("");
    setPassword("");
    setRole("Visitor");
    setError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await create.mutateAsync({ username: username.trim(), password, role });
      toast.success(`Created ${username.trim()} as ${role}`);
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Create failed");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite user</DialogTitle>
          <DialogDescription>
            Provision a new operator. Share the credentials securely; the user can change their
            password after first sign-in.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="u-name">Username</Label>
            <Input
              id="u-name"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              maxLength={32}
              pattern="[A-Za-z0-9_\-]+"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="u-pw">Initial password</Label>
            <Input
              id="u-pw"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {USER_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && (
            <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
              {error}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({
  target,
  onOpenChange,
}: {
  target: ManagedUser | null;
  onOpenChange: (o: boolean) => void;
}) {
  const update = useUpdateUser();
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<UserRole>("Visitor");
  const [error, setError] = useState<string | null>(null);

  useMemoizedSync(target, (t) => {
    setUsername(t.username);
    setRole(t.role);
    setError(null);
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    setError(null);
    const patch: { id: number; username?: string; role?: UserRole } = { id: target.id };
    if (username.trim() !== target.username) patch.username = username.trim();
    if (role !== target.role) patch.role = role;
    if (!patch.username && !patch.role) {
      onOpenChange(false);
      return;
    }
    try {
      await update.mutateAsync(patch);
      toast.success(`Updated ${target.username}`);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed");
    }
  }

  return (
    <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit user</DialogTitle>
          <DialogDescription>Rename or change the role for {target?.username}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="e-name">Username</Label>
            <Input
              id="e-name"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              maxLength={32}
              pattern="[A-Za-z0-9_\-]+"
            />
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {USER_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && (
            <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
              {error}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  target,
  onOpenChange,
}: {
  target: ManagedUser | null;
  onOpenChange: (o: boolean) => void;
}) {
  const reset = useResetUserPassword();
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | null>(null);

  useMemoizedSync(target, () => {
    setPw("");
    setError(null);
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    setError(null);
    try {
      await reset.mutateAsync({ id: target.id, password: pw });
      toast.success(`Password reset for ${target.username}`);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Reset failed");
    }
  }

  return (
    <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>
            Set a new password for {target?.username}. They'll need to sign in again.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rp-pw">New password</Label>
            <Input
              id="rp-pw"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
            />
          </div>
          {error && (
            <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
              {error}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={reset.isPending}>
              {reset.isPending ? "Saving…" : "Reset password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Tiny helper: run the side-effect once per `target` identity change. Avoids
// the typical useEffect-with-stale-closure footgun for "sync state when a
// dialog target changes" — without pulling in a heavier abstraction.
function useMemoizedSync<T>(value: T, fn: (v: NonNullable<T>) => void) {
  useMemo(() => {
    if (value) fn(value as NonNullable<T>);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
}
