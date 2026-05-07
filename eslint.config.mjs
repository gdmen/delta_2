import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Claude Code worktree copies — not part of the checked-in tree,
    // only present locally. CI doesn't see them; local lint shouldn't
    // either (otherwise we get duplicate diagnostics for the same code).
    ".claude/**",
  ]),
]);

export default eslintConfig;
