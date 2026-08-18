/**
 * CI audit gate: `npm audit` with a reviewed accepted-risk allowlist.
 *
 * Plain `npm audit --audit-level=high` cannot exempt an advisory, so an
 * unpatchable transitive advisory leaves the job permanently red and trains
 * everyone to ignore it. This script fails on any high/critical advisory
 * EXCEPT the GHSA IDs explicitly allowlisted below. Every allowlist entry
 * must have a matching entry in docs/security.mdx "Known accepted risks"
 * (with rationale, acceptance date, and clearing condition) — the allowlist
 * is the enforcement half of that document, not a place to park noise.
 */
import { execFileSync } from "node:child_process";

/** GHSA IDs accepted per docs/security.mdx "Known accepted risks". */
const ACCEPTED_ADVISORIES = new Set([
  // extract-zip symlink traversal via puppeteer@24 -> @puppeteer/browsers@2.
  // Install-time only (Chromium download from Google's CDN); no patch exists.
  // Accepted 2026-08-18; clears with the Puppeteer 25 upgrade.
  "GHSA-jmr9-qjv8-65gv",
]);

const FAILING_SEVERITIES = new Set(["high", "critical"]);

interface AuditAdvisory {
  severity: string;
  url?: string;
  title?: string;
}

interface AuditVulnerability {
  name: string;
  severity: string;
  via: Array<string | AuditAdvisory>;
}

function ghsaIdFromUrl(url: string | undefined): string | undefined {
  return url?.match(/GHSA-[a-z0-9-]+/i)?.[0];
}

function runNpmAudit(): Record<string, AuditVulnerability> {
  let stdout: string;
  try {
    stdout = execFileSync("npm", ["audit", "--json"], { encoding: "utf8" });
  } catch (error) {
    // npm audit exits non-zero when vulnerabilities exist; the JSON report
    // is still on stdout.
    const failed = error as { stdout?: string };
    if (!failed.stdout) throw error;
    stdout = failed.stdout;
  }
  return (JSON.parse(stdout).vulnerabilities ?? {}) as Record<string, AuditVulnerability>;
}

function main() {
  const vulnerabilities = runNpmAudit();

  // A package fails if it carries a direct advisory that is failing-severity
  // and not allowlisted, or if it inherits (via a package-name reference) from
  // a package that fails. Iterate to a fixpoint to resolve inheritance chains.
  const failing = new Set<string>();
  const failureReasons = new Map<string, string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [packageName, vulnerability] of Object.entries(vulnerabilities)) {
      if (failing.has(packageName)) continue;
      for (const via of vulnerability.via) {
        if (typeof via === "string") {
          if (failing.has(via)) {
            failing.add(packageName);
            failureReasons.set(packageName, `inherits from ${via}`);
            changed = true;
            break;
          }
        } else if (FAILING_SEVERITIES.has(via.severity)) {
          const ghsaId = ghsaIdFromUrl(via.url);
          if (!ghsaId || !ACCEPTED_ADVISORIES.has(ghsaId)) {
            failing.add(packageName);
            failureReasons.set(packageName, `${ghsaId ?? via.url ?? "unknown"}: ${via.title ?? ""}`);
            changed = true;
            break;
          }
        }
      }
    }
  }

  const suppressedCount = Object.entries(vulnerabilities).filter(
    ([packageName, vulnerability]) =>
      !failing.has(packageName) && FAILING_SEVERITIES.has(vulnerability.severity),
  ).length;

  if (failing.size > 0) {
    console.error("audit:check FAILED — high/critical advisories outside the accepted-risk allowlist:");
    for (const packageName of failing) {
      console.error(`  ${packageName} — ${failureReasons.get(packageName)}`);
    }
    console.error(
      "\nFix the advisory, or (with maintainer sign-off) add its GHSA ID to ACCEPTED_ADVISORIES",
    );
    console.error('and document it under "Known accepted risks" in docs/security.mdx.');
    process.exit(1);
  }

  console.log(
    `audit:check OK — no unaccepted high/critical advisories` +
      (suppressedCount > 0
        ? ` (${suppressedCount} finding(s) suppressed by the reviewed allowlist: ${[...ACCEPTED_ADVISORIES].join(", ")})`
        : ""),
  );
}

main();
