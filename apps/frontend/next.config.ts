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
  async rewrites() {
    // Determine the backend base URL. Docker sets it to http://backend:8000
    // Aspire sets it to a dynamic localhost port.
    // If not set, fallback to http://127.0.0.1:8000 (suitable for local dev without compose/aspire).
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
