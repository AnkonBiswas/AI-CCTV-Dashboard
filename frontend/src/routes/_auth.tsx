import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth")({
  beforeLoad: ({ context }) => {
    if (context.auth?.token) {
      throw redirect({ to: "/" });
    }
  },
  component: AuthLayout,
});

function AuthLayout() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 justify-center mb-8">
          <div className="size-9 rounded-md bg-primary text-primary-foreground grid place-items-center glow-accent">
            <div className="size-3.5 rounded-full border-2 border-current" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-bold tracking-tight">KLAPIFY AI</div>
            <div className="text-[10px] text-muted-foreground text-mono uppercase tracking-widest">
              v3.4 · secure
            </div>
          </div>
        </div>
        <div className="bg-panel border border-border rounded-xl p-6">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
