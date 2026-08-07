import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: ["ws"],
  turbopack: {
    root: process.cwd(),
    resolveAlias: {
      ws: { browser: "./node_modules/isows/_esm/index.js" },
    },
  },
};

export default nextConfig;
