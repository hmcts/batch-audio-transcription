import type { NextConfig } from "next";
import { BASE_PATH } from "./lib/base-path";

const nextConfig: NextConfig = {
  output: "standalone",
  basePath: BASE_PATH,
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
