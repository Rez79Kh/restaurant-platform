import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// No nonces: they would force every page to render per request for a gain we
// don't need. React escapes everything we render and no user-supplied HTML is
// ever injected, so 'unsafe-inline' (required for Next's inline hydration
// scripts without nonces) is an accepted trade-off. Everything is same-origin:
// fonts are self-hosted, the AI is called server-side only.
// Deliberately no `upgrade-insecure-requests`: the one-command Docker setup
// serves plain http://localhost; on Vercel, HSTS covers it.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // Ignored by browsers over plain HTTP, so harmless for local Docker.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The menu photo uses a file input (with capture), not getUserMedia.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

// Cache Components (the create-next-app default) is deliberately off. Every
// screen shows per-tenant, per-session data that changes every few seconds;
// there is nothing worth caching on the server, and a server cache keyed on
// the wrong thing is a cross-tenant leak waiting to happen.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
