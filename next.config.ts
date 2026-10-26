import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pg-boss", "postgres"],
  poweredByHeader: false,
  agentRules: false,
  devIndicators: false,
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default config;
