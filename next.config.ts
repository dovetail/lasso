import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pg-boss", "postgres"],
  poweredByHeader: false,
};

export default config;
