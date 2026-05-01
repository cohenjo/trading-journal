import type { NextConfig } from "next";

function isPrivateBackendHost(hostname: string): boolean {
  const normalizedHostname = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const ipv4Match = normalizedHostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);

  if (ipv4Match) {
    const octets = ipv4Match.slice(1).map(Number);
    if (octets.some((octet) => octet > 255)) {
      return false;
    }

    const [first, second] = octets;
    return (
      first === 10 ||
      first === 127 ||
      first === 0 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 169 && second === 254)
    );
  }

  if (normalizedHostname === "localhost" || normalizedHostname === "::1") {
    return true;
  }

  if (!normalizedHostname.includes(":")) {
    return false;
  }

  const firstHextet = normalizedHostname.split(":")[0];
  return (
    firstHextet.startsWith("fc") ||
    firstHextet.startsWith("fd") ||
    normalizedHostname.startsWith("fe80:")
  );
}

function assertProductionBackendUrl(envUrl: string): void {
  let backendUrl: URL;

  try {
    backendUrl = new URL(envUrl);
  } catch {
    throw new Error(
      `NEXT_PUBLIC_API_URL must be a valid absolute URL in production (got ${envUrl}).`,
    );
  }

  if (!/^https?:$/.test(backendUrl.protocol)) {
    throw new Error(
      `NEXT_PUBLIC_API_URL must use http or https in production (got ${envUrl}).`,
    );
  }

  if (isPrivateBackendHost(backendUrl.hostname)) {
    throw new Error(
      `NEXT_PUBLIC_API_URL must not point at localhost or a private address in production (got ${envUrl}). Vercel cannot reach private addresses.`,
    );
  }
}

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
    const isProduction = process.env.NODE_ENV === "production";
    const envUrl = process.env.NEXT_PUBLIC_API_URL?.trim();

    if (isProduction) {
      if (!envUrl) {
        throw new Error(
          "NEXT_PUBLIC_API_URL is required in production. Set it in Vercel env vars to the public backend URL (e.g. https://api.example.com).",
        );
      }

      assertProductionBackendUrl(envUrl);
    }

    const backendUrl = envUrl || "http://127.0.0.1:8000";

    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
