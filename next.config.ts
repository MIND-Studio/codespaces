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
  transpilePackages: ["@mind-studio/core", "@mind-studio/ui"],
};

export default nextConfig;
