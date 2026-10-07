import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The HUD makes no network requests at runtime; the dev server binds to loopback only
// (see the "dev" script). Tests read shared fixtures from ../shared.
export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", fs: { allow: [".."] } },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
