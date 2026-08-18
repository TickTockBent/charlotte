/**
 * GitHub-safe docs lint (see CLAUDE.md "Docs").
 *
 * docs/ is canonical for user docs and must render on BOTH Mintlify and
 * GitHub. GitHub renders .mdx but strips JSX tags while keeping their
 * children, so anything carried in a component attribute (a Card's title and
 * href, a Step's title) is silently lost, and {/* ... *\/} MDX comments leak
 * into the page as visible text. This lint fails the build on constructs that
 * degrade lossily:
 *
 *   1. Components other than the children-only callouts
 *      (Note, Warning, Tip, Info, Danger).
 *   2. MDX comments.
 *   3. Site-root-relative markdown links ("](/page)") — broken on GitHub;
 *      use absolute https://charlotte.mintlify.site/... URLs.
 *
 * Fenced code blocks and inline code spans are exempt.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";

const DOCS_DIR = path.resolve(import.meta.dirname, "../docs");
const ALLOWED_COMPONENTS = new Set(["Note", "Warning", "Tip", "Info", "Danger"]);

interface LintFinding {
  file: string;
  line: number;
  message: string;
}

function stripCodeSpans(line: string): string {
  return line.replace(/`[^`]*`/g, "``");
}

async function lintFile(filePath: string): Promise<LintFinding[]> {
  const findings: LintFinding[] = [];
  const relativePath = path.relative(process.cwd(), filePath);
  const lines = (await fs.readFile(filePath, "utf8")).split("\n");

  let inFence = false;
  for (let index = 0; index < lines.length; index++) {
    const rawLine = lines[index];
    if (/^\s*(```|~~~)/.test(rawLine)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const line = stripCodeSpans(rawLine);
    const lineNumber = index + 1;

    for (const match of line.matchAll(/<\/?([A-Z][A-Za-z]*)\b/g)) {
      const componentName = match[1];
      if (!ALLOWED_COMPONENTS.has(componentName)) {
        findings.push({
          file: relativePath,
          line: lineNumber,
          message: `<${componentName}> is not GitHub-safe — GitHub strips JSX tags and drops attribute content. Use headings, lists, and links instead (allowed callouts: ${[...ALLOWED_COMPONENTS].join(", ")}).`,
        });
      }
    }

    if (line.includes("{/*") || line.includes("*/}")) {
      findings.push({
        file: relativePath,
        line: lineNumber,
        message:
          "MDX comment — GitHub renders {/* ... */} as visible text. Remove it (record maintainer context in CLAUDE.md instead).",
      });
    }

    for (const match of line.matchAll(/\]\((\/[^)]*)\)/g)) {
      findings.push({
        file: relativePath,
        line: lineNumber,
        message: `Site-root-relative link "${match[1]}" breaks on GitHub — use an absolute https://charlotte.mintlify.site/... URL.`,
      });
    }
  }

  return findings;
}

async function main() {
  const entries = await fs.readdir(DOCS_DIR);
  const docFiles = entries
    .filter((name) => name.endsWith(".mdx") || name.endsWith(".md"))
    .map((name) => path.join(DOCS_DIR, name));

  const findings = (await Promise.all(docFiles.map(lintFile))).flat();

  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`${finding.file}:${finding.line} — ${finding.message}`);
    }
    console.error(`\nlint:docs failed with ${findings.length} finding(s).`);
    process.exit(1);
  }
  console.log(`lint:docs OK (${docFiles.length} files checked).`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
