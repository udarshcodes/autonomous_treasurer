import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages are consumed as TypeScript source.
  transpilePackages: ["@treasurer/shared"],
};

export default config;
