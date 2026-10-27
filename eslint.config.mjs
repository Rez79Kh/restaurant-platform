import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Tenant isolation, layer 3: application code reaches tenant data only
  // through withTenant(). The raw client is allowed in the few places that
  // legitimately run before or outside a tenant context.
  {
    files: ["**/*.ts", "**/*.tsx"],
    ignores: ["lib/db.ts", "lib/tenant.ts", "app/api/health/route.ts", "tests/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/db",
              message: "Use withTenant() from @/lib/tenant for tenant data.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Prisma client, generated on install.
    "generated/**",
  ]),
]);

export default eslintConfig;
