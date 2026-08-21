import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Must come AFTER the spreads above, which set react.version to "detect".
  // eslint-plugin-react 7.37.5 (pinned by eslint-config-next) crashes on
  // ESLint 10 when it auto-detects: its resolveBasedir() calls the removed
  // context.getFilename(). Pinning the version skips that detection path.
  { settings: { react: { version: "19.2" } } },
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
