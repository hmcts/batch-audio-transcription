import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  basePath: "/batch",
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
