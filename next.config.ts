import type { NextConfig } from "next";

// Cache Components (the create-next-app default) is deliberately off. Every
// screen shows per-tenant, per-session data that changes every few seconds;
// there is nothing worth caching on the server, and a server cache keyed on
// the wrong thing is a cross-tenant leak waiting to happen.
const nextConfig: NextConfig = {
  poweredByHeader: false,
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
