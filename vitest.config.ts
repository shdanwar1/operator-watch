import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests must exercise handlers directly, without Start's RPC build transform.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  esbuild: { jsx: "automatic" },
  test: { include: ["src/**/*.test.{ts,tsx}"] },
});
