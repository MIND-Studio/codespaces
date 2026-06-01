import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Git Smart HTTP needs to stream request bodies and responses without
  // Next.js buffering them. Keep the default Node runtime; route handlers
  // opt-in to streaming via `export const dynamic = "force-dynamic"`.

  // Emit `.next/standalone/` so the production Docker image can ship a
  // minimal self-contained server (server.js + only the deps it actually
  // imports) instead of the full node_modules tree. Dev (`next dev`) is
  // unaffected.
  output: "standalone",
  // The OCI Distribution version check is `GET /v2/` *with* the trailing
  // slash, and docker treats anything other than 200/401 as "not a v2
  // registry". Next's default would 308-redirect `/v2/` → `/v2`, which
  // breaks that ping. Skipping the trailing-slash redirect lets the
  // `/v2/[[...path]]` handler answer `/v2/` directly. Both slash variants
  // still resolve for every other route.
  skipTrailingSlashRedirect: true,
  transpilePackages: ["@mind-studio/core", "@mind-studio/ui"],
};

export default nextConfig;
