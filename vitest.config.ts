import * as os from "node:os";
import { defineConfig } from "vitest/config";

// Each integration test file launches its own Chromium. With ~20+ integration
// files, unbounded forks spawn that many concurrent browsers and starve a
// loaded CI runner, causing timing flakes (#206). Cap the fork pool to a
// sane fraction of the available cores (at least 2).
const maxForks = Math.max(2, Math.min(os.cpus().length, 4));

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30000,
    // Git worktrees (agent sandboxes, .claude/worktrees/) live inside the
    // repo and contain full copies of tests/ — never collect from them.
    exclude: ["**/node_modules/**", "**/.claude/**", "**/dist/**"],
    pool: "forks",
    poolOptions: {
      forks: {
        maxForks,
        minForks: 1,
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
      // Thresholds set slightly below actuals (measured 2026-06-09) so CI
      // catches regressions but passes today.
      // Overall: stmts 81.62%, branches 73.68%, fns 84.36%, lines 82.32%
      thresholds: {
        statements: 80,
        branches: 72,
        functions: 83,
        lines: 81,
        // Protect src/tools especially — it has the lowest coverage.
        // Actuals: stmts 65.83%, branches 53.57%, fns 69.04%, lines 66.3%
        "src/tools/**": {
          statements: 64,
          branches: 52,
          functions: 67,
          lines: 65,
        },
      },
    },
  },
});
