import type { NextConfig } from "next";

// Keep in sync with NEXT_PUBLIC_BASE_PATH in base-path.ts.
// Both read from the same env var so there is a single point of change.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/batch";

const nextConfig: NextConfig = {
  output: "standalone",
  basePath: BASE_PATH,
  turbopack: {
    root: __dirname,
  },
  experimental: {
    // Next.js clones every request body against this limit (default 10MB) and
    // truncates anything larger, which corrupts multipart uploads. The batch
    // service accepts long audio recordings (up to ~2h), so raise the ceiling
    // well above realistic audio file sizes. See DIAAT-268.
    proxyClientMaxBodySize: "500mb",
  },
};

export default nextConfig;
