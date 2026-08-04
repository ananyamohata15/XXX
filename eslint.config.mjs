import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // API-first boundary (CLAUDE.md hard constraint 5): client code never
  // imports business logic. src/server/** is reachable only from
  // src/app/api/** route handlers; everything else talks to the API over HTTP.
  {
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    ignores: ["src/app/api/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/server",
                "@/server/**",
                "./server/**",
                "../server/**",
                "../../server/**",
                "../../../server/**",
                "**/src/server/**",
              ],
              message:
                "Client code must not import src/server/** — call the API in src/app/api/ instead (API-first rule).",
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
  ]),
]);

export default eslintConfig;
