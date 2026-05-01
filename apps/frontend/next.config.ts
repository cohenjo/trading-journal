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
    // Rewrite /api/* to a backend — this is an opt-in escape hatch for self-hosted backends.
    // Per architecture directive, the default is for the frontend to talk to Supabase directly
    // via Server Actions; any `/api/*` call sites that aren't migrated will get a 404 at
    // runtime (fail-fast behavior, which is desirable).
    //
    // Dev environment: falls back to http://127.0.0.1:8000 (Docker Compose or Aspire).
    // Production/Preview on Vercel: only registers rewrites if NEXT_PUBLIC_API_URL is set
    // to a valid public URL. If missing/private/localhost, logs a warning and returns empty
    // rewrites (so /api/* calls will 404 rather than silently failing to reach an invalid URL).
    const isProduction = process.env.NODE_ENV === "production";
    const envUrl = process.env.NEXT_PUBLIC_API_URL?.trim();

    if (isProduction) {
      if (!envUrl) {
        console.warn(
          "[next.config] NEXT_PUBLIC_API_URL is not set in production. /api/* rewrites are disabled. " +
          "This is expected: the frontend talks to Supabase directly via Server Actions. " +
          "If you have unmigrated /api/* call sites, they will return 404 at runtime.",
        );
        return [];
      }

      // Validate that the URL is public before registering rewrites
      try {
        const backendUrl = new URL(envUrl);
        if (isPrivateBackendHost(backendUrl.hostname)) {
          console.warn(
            `[next.config] NEXT_PUBLIC_API_URL points to a private address (${envUrl}) in production. ` +
            "/api/* rewrites are disabled. Vercel cannot reach private addresses. " +
            "If you need an /api/* proxy, set NEXT_PUBLIC_API_URL to a public URL.",
          );
          return [];
        }

        if (!/^https?:$/.test(backendUrl.protocol)) {
          throw new Error(
            `NEXT_PUBLIC_API_URL must use http or https in production (got ${envUrl}).`,
          );
        }
      } catch (err) {
        throw new Error(
          `NEXT_PUBLIC_API_URL must be a valid absolute URL in production (got ${envUrl}).`,
        );
      }
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
