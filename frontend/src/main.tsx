import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";

import "./styles.css";
import { routeTree } from "./routeTree.gen";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { SocketProvider } from "@/hooks/useSocket";
import { Toaster } from "@/components/ui/sonner";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
});

const router = createRouter({
  routeTree,
  context: { queryClient, auth: undefined! },
  scrollRestoration: true,
  defaultPreloadStaleTime: 0,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function InnerApp() {
  const auth = useAuth();
  return <RouterProvider router={router} context={{ queryClient, auth }} />;
}

function App() {
  return (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <SocketProvider>
            <InnerApp />
            <Toaster />
          </SocketProvider>
        </AuthProvider>
      </QueryClientProvider>
    </StrictMode>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
