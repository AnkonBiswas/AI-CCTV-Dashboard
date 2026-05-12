import { Link, useMatches, useRouterState } from "@tanstack/react-router";
import {
  LayoutGrid,
  Video,
  Users,
  CalendarCheck2,
  Route as RouteIcon,
  Flame,
  Shield,
  Settings,
  Search,
  Bell,
  ChevronDown,
  ListFilter,
  AlertTriangle,
  LogOut,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useIncidentLogStream } from "@/hooks/useSocket";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SystemHealthCard } from "@/components/SystemHealthCard";

import type { UserRole } from "@/types/api";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutGrid;
  exact?: boolean;
  badge?: boolean;
  roles?: UserRole[]; // omit = visible to everyone signed in
};

const nav: NavItem[] = [
  { to: "/", label: "Live Monitor", icon: LayoutGrid, exact: true },
  { to: "/cameras", label: "Cameras", icon: Video },
  { to: "/people", label: "People Registry", icon: Users },
  { to: "/attendance", label: "Attendance", icon: CalendarCheck2 },
  { to: "/tracking", label: "Tracking", icon: RouteIcon },
  { to: "/heatmap", label: "Heatmap", icon: Flame },
  { to: "/incidents", label: "Incidents", icon: AlertTriangle, badge: true },
  { to: "/users", label: "User Management", icon: Shield, roles: ["Admin"] },
  { to: "/settings", label: "Settings", icon: Settings, roles: ["Admin", "Moderator"] },
];

const ROLE_BADGE: Record<UserRole, string> = {
  Admin: "bg-primary/15 text-primary border-primary/30",
  Moderator: "bg-warning/15 text-warning border-warning/30",
  Visitor: "bg-muted text-muted-foreground border-border",
};

type RouteStaticData = { title?: string; subtitle?: string };

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const matches = useMatches();
  const last = matches[matches.length - 1];
  const staticData = (last?.staticData ?? {}) as RouteStaticData;
  const title = staticData.title ?? "Klapify AI";
  const subtitle = staticData.subtitle;
  const { user, role, logout } = useAuth();
  const [unread, setUnread] = useState(0);
  const visibleNav = nav.filter((item) => !item.roles || (role && item.roles.includes(role)));

  useIncidentLogStream((ev) => {
    if (ev.type === "fire" || ev.type === "smoke") setUnread((n) => n + 1);
  });

  useEffect(() => {
    if (pathname === "/incidents") setUnread(0);
  }, [pathname]);

  const initials = (user?.username?.[0] || "?").toUpperCase();

  return (
    <div className="flex h-screen w-full bg-background text-foreground">
      <aside className="w-60 shrink-0 border-r border-border bg-panel flex flex-col">
        <div className="px-5 py-5 flex items-center gap-3">
          <div className="size-8 rounded-md bg-primary text-primary-foreground grid place-items-center glow-accent">
            <div className="size-3 rounded-full border-2 border-current" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-bold tracking-tight">KLAPIFY AI</div>
            <div className="text-[10px] text-muted-foreground text-mono uppercase tracking-widest">
              v3.4 · secure
            </div>
          </div>
        </div>

        <div className="px-3 mt-2 flex-1 overflow-y-auto">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground px-3 mb-2">
            Surveillance
          </div>
          <nav className="space-y-0.5">
            {visibleNav.map((item) => {
              const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                    active
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-panel-elevated border border-transparent"
                  }`}
                >
                  <Icon className="size-4" />
                  <span className="font-medium">{item.label}</span>
                  {item.badge && unread > 0 && (
                    <span className="ml-auto text-[10px] text-mono bg-destructive text-destructive-foreground rounded-full px-1.5 py-0.5">
                      {unread}
                    </span>
                  )}
                  {active && !item.badge && (
                    <span className="ml-auto size-1.5 rounded-full bg-primary glow-accent" />
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="mt-6">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground px-3 mb-2">
              System
            </div>
            <SystemHealthCard />
          </div>
        </div>

        <div className="p-3 border-t border-border">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-full flex items-center gap-3 px-3 py-2 rounded-md bg-panel-elevated hover:bg-panel-elevated/70 transition text-left">
                <div className="size-8 rounded-full bg-primary/20 text-primary grid place-items-center text-xs font-bold uppercase">
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold truncate">
                    {user?.username ?? "Guest"}
                  </div>
                  <div className="text-[10px] text-muted-foreground">{role ?? "Account"}</div>
                </div>
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="flex items-center gap-2">
                <span className="truncate">{user?.username ?? "Account"}</span>
                {role && (
                  <span
                    className={`text-[10px] text-mono uppercase px-1.5 py-0.5 border rounded ${ROLE_BADGE[role]}`}
                  >
                    {role}
                  </span>
                )}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {(role === "Admin" || role === "Moderator") && (
                <DropdownMenuItem asChild>
                  <Link to="/settings">
                    <Settings className="size-3.5" />
                    Settings
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
                <LogOut className="size-3.5" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 border-b border-border bg-background/60 backdrop-blur flex items-center justify-between px-8 shrink-0">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight truncate">{title}</h1>
            {subtitle && <p className="text-xs text-muted-foreground text-mono truncate">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2 h-9 w-72 px-3 rounded-md bg-panel border border-border text-xs text-muted-foreground">
              <Search className="size-3.5" />
              <span>Search people, cameras, events…</span>
              <kbd className="ml-auto text-[10px] text-mono bg-panel-elevated border border-border px-1.5 py-0.5 rounded">
                ⌘K
              </kbd>
            </div>
            <Link
              to="/incidents"
              className="relative size-9 rounded-md bg-panel border border-border grid place-items-center hover:bg-panel-elevated transition"
            >
              <Bell className="size-4 text-muted-foreground" />
              {unread > 0 && (
                <span className="absolute -top-1 -right-1 text-[10px] text-mono bg-destructive text-destructive-foreground rounded-full px-1.5 py-0.5">
                  {unread}
                </span>
              )}
            </Link>
            <div className="flex items-center gap-2 text-mono text-xs px-3 h-9 rounded-md bg-panel border border-border">
              <span className="size-1.5 rounded-full bg-primary animate-pulse" />
              SYSTEM ACTIVE
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">{children}</div>
      </main>
    </div>
  );
}

export function StatCard({
  label,
  value,
  delta,
  tone = "default",
}: {
  label: string;
  value: string;
  delta?: string;
  tone?: "default" | "success" | "warning" | "destructive";
}) {
  const toneClass =
    tone === "warning"
      ? "text-warning"
      : tone === "destructive"
        ? "text-destructive"
        : tone === "success"
          ? "text-success"
          : "text-foreground";
  return (
    <div className="bg-panel border border-border rounded-xl p-5">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground text-mono">
        {label}
      </div>
      <div className={`mt-2 text-3xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
      {delta && <div className="mt-1 text-[11px] text-muted-foreground text-mono">{delta}</div>}
    </div>
  );
}

export function Avatar({
  initials,
  color,
  size = 40,
}: {
  initials: string;
  color: string;
  size?: number;
}) {
  return (
    <div
      className="rounded-md grid place-items-center font-semibold text-background text-xs shrink-0"
      style={{ width: size, height: size, background: color, fontSize: size * 0.34 }}
    >
      {initials}
    </div>
  );
}

export function PageActions({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-2">{children}</div>;
}

export function EmptyHint({
  title,
  description,
  icon: Icon = ListFilter,
}: {
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="size-12 rounded-full bg-panel-elevated grid place-items-center text-muted-foreground">
        <Icon className="size-5" />
      </div>
      <div className="mt-3 text-sm font-semibold">{title}</div>
      {description && (
        <div className="mt-1 text-xs text-muted-foreground max-w-xs">{description}</div>
      )}
    </div>
  );
}
