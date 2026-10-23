import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Prisma's engine must stay external to the server bundle.
  serverExternalPackages: ["@prisma/client", "prisma"],
};

export default nextConfig;
