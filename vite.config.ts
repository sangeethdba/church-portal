import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const PORT = Number(process.env.PORT ?? 5173);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      host: "0.0.0.0",
      port: PORT,
      strictPort: false,
      // Freebuff requires HMR to remain disabled
      hmr: false,
    },
    preview: {
      host: "0.0.0.0",
      port: PORT,
    },
    build: {
      target: "es2022",
      sourcemap: true,
    },
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(env.VITE_SUPABASE_URL ?? ""),
      "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(env.VITE_SUPABASE_ANON_KEY ?? ""),
      "import.meta.env.VITE_SITE_URL": JSON.stringify(env.VITE_SITE_URL ?? ""),
    },
  };
});
