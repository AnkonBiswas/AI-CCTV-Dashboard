import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: "src/routes",
      generatedRouteTree: "src/routeTree.gen.ts",
    }),
    react(),
    tailwindcss(),
  ],
  server: {
    port: 8080,
    strictPort: true,
    host: "127.0.0.1",
  },
  preview: {
    port: 8080,
    strictPort: true,
    host: "127.0.0.1",
  },
});
