import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

export default defineConfig({
  resolve: {
    alias: {
      // The `server-only` guard is enforced by the Next.js build; under Vitest it would simply
      // refuse to import any server module, so it is stubbed for tests alone.
      "server-only": fileURLToPath(new URL("./tests/server-only-stub.ts", import.meta.url)),
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: { include: ["**/*.test.ts"], exclude: ["node_modules/**", ".next/**", "tests/e2e/**"] },
})
