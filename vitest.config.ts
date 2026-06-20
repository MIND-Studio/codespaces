import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Each test file gets its own registry data dir under .test-data/.
    // Vitest sets NODE_ENV=test by default — our env module accepts that
    // as a "development-ish" mode so the production validators don't fire.
    environment: "node",
  },
  resolve: {
    // Mirror tsconfig's `@/*` alias so test files can import production
    // modules with the same paths the app uses.
    alias: {
      "@": resolve(__dirname, "./src"),
      // The `server-only` package throws unconditionally outside the
      // react-server condition (Next.js sets it; vitest doesn't). Map
      // the import to the package's own empty stub so production
      // modules that mark themselves server-only can still be unit-
      // tested under vitest.
      "server-only": resolve(__dirname, "./node_modules/server-only/empty.js"),
    },
  },
});
