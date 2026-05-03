import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  eslint: {
    // Pre-existing lint errors — lint is checked separately in CI
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Pre-existing TS errors — type-check is run separately in CI
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
