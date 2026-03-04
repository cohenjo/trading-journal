import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
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
