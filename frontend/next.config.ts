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
};

export default nextConfig;
