import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  worker: { format: "es" },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          flow: ["@xyflow/react"],
          inkjs: ["inkjs"],
        },
      },
    },
  },
});
