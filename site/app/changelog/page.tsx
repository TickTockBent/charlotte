import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Changelog — Charlotte",
  description: "Release history for Charlotte, the MCP server for structured web browsing.",
};

interface ChangeEntry {
  type: "added" | "changed" | "fixed" | "removed";
  text: string;
}

interface Release {
  version: string;
  date: string;
  entries: ChangeEntry[];
}

const releases: Release[] = [
  {
    version: "0.4.2",
    date: "2026-03-06",
    entries: [
      { type: "added", text: "charlotte:upload — Set files on <input type=\"file\"> elements via CDP. Validates file existence and element type. Closes GAP-02." },
      { type: "added", text: "File input detection — File inputs now correctly identified as file_input type instead of button." },
      { type: "added", text: "charlotte:key enhancement — Added keys (sequence), element_id (focus targeting), and delay parameters for keyboard-driven UIs." },
      { type: "fixed", text: "Boolean parameter validation — All boolean parameters now accept string-coerced values (\"true\"/\"false\") from MCP clients." },
      { type: "fixed", text: "click_at hover simulation — Moves mouse to coordinates and pauses before clicking, fixing framework-managed link navigation." },
    ],
  },
  {
    version: "0.4.1",
    date: "2026-03-05",
    entries: [
      { type: "added", text: "charlotte:click_at — Click at specific page coordinates for non-semantic elements (custom widgets, canvas, SVG)." },
      { type: "added", text: "CSS selector mode for charlotte:find — Query the DOM directly via selector parameter, returning elements with Charlotte IDs." },
      { type: "fixed", text: "charlotte:evaluate silent null on multi-statement code — Replaced with CDP Runtime.evaluate for correct completion values." },
    ],
  },
  {
    version: "0.4.0",
    date: "2026-03-03",
    entries: [
      { type: "added", text: "Tiered tool visibility — Startup profiles control which tools load into the agent's context. Six profiles: core (7), browse (22), interact (27), develop (30), audit (13), full (40). Granular group selection via --tools." },
      { type: "added", text: "charlotte:tools meta-tool — Runtime tool group management. List, enable, and disable tool groups mid-session without restarting." },
      { type: "added", text: "Profile benchmark suite — Four tests measuring tool definition overhead across full, browse, and core profiles." },
      { type: "added", text: "charlotte:drag — Drag an element to another element using mouse primitives. Closes GAP-01." },
      { type: "added", text: "Landmark IDs — Landmarks now have stable hash-based IDs (rgn-xxxx) for tool referencing." },
      { type: "added", text: "charlotte:console — Retrieve console messages with level filtering and buffer clearing. Closes GAP-21." },
      { type: "added", text: "charlotte:requests — Retrieve network request history with URL, resource type, and status filters. Closes GAP-22." },
      { type: "added", text: "Modifier key clicks — charlotte:click now accepts ctrl, shift, alt, meta modifiers for all click types." },
      { type: "fixed", text: "Pseudo-element content duplication — extractFullContent() no longer emits duplicate text from CSS ::before/::after pseudo-elements." },
      { type: "changed", text: "Default startup profile is now browse (22 tools) instead of loading all 40 tools. Use --profile=full for the previous behavior." },
      { type: "changed", text: "PageManager now captures all console messages and network responses (not just errors). Ring buffers capped at 1000 entries." },
      { type: "changed", text: "Static server binds to 127.0.0.1 instead of 0.0.0.0. Directory traversal prevention via allowedWorkspaceRoot." },
    ],
  },
  {
    version: "0.3.0",
    date: "2026-02-24",
    entries: [
      { type: "added", text: "charlotte:dialog — Accept or dismiss JavaScript dialogs (alert, confirm, prompt, beforeunload). Closes GAP-03." },
      { type: "added", text: "Dialog-aware action racing — Clicks that trigger dialogs return immediately instead of hanging for 30s." },
      { type: "added", text: "dialog_auto_dismiss configuration — Auto-handle dialogs via charlotte:configure. Options: none, accept_alerts, accept_all, dismiss_all." },
      { type: "added", text: "Dialog-blocking stub responses — Minimal stub representation when a dialog is blocking, so agents always know a dialog needs handling." },
      { type: "changed", text: "PageManager now accepts CharlotteConfig in its constructor for dialog auto-dismiss configuration." },
    ],
  },
  {
    version: "0.2.0",
    date: "2026-02-22",
    entries: [
      { type: "changed", text: "Compact response format — Responses are 50-99% smaller. Charlotte's navigate returns 336 chars for Hacker News vs Playwright MCP's 61,230." },
      { type: "changed", text: "Interactive summary for minimal detail — Element counts by landmark region instead of full element lists. Wikipedia dropped from 711K to 7.7K chars." },
      { type: "changed", text: "Default state stripping — Interactive elements omit redundant defaults (enabled: true, visible: true, focused: false)." },
      { type: "changed", text: "Navigation defaults to minimal detail. Pass detail: \"summary\" or \"full\" for more context." },
      { type: "removed", text: "Removed unused alerts field from page representation." },
    ],
  },
  {
    version: "0.1.3",
    date: "2026-02-22",
    entries: [
      { type: "added", text: "Benchmark suite for comparing Charlotte against Playwright MCP across real websites." },
    ],
  },
  {
    version: "0.1.2",
    date: "2026-02-22",
    entries: [
      { type: "changed", text: "Added mcpName field for MCP registry publishing." },
    ],
  },
  {
    version: "0.1.1",
    date: "2026-02-22",
    entries: [
      { type: "added", text: "get_cookies — Retrieve cookies for the active page with optional URL filtering." },
      { type: "added", text: "clear_cookies — Clear cookies with optional name filtering." },
      { type: "fixed", text: "Session integration tests now use HTTP URLs for cookie operations." },
    ],
  },
  {
    version: "0.1.0",
    date: "2026-02-13",
    entries: [
      { type: "added", text: "Initial release. All six implementation phases complete: navigation, observation, interaction, session, development, and utility tools." },
      { type: "added", text: "Renderer pipeline: accessibility tree + layout geometry + interactive element extraction." },
      { type: "added", text: "Hash-based element IDs stable across re-renders." },
      { type: "added", text: "Snapshot store with ring buffer and structural diffing." },
      { type: "added", text: "222 tests across 19 test files (unit + integration)." },
    ],
  },
];

const typeBadgeClass: Record<ChangeEntry["type"], string> = {
  added: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  changed: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  fixed: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  removed: "bg-red-500/15 text-red-400 border-red-500/20",
};

export default function ChangelogPage() {
  return (
    <div className="min-h-screen bg-background" data-axiom-page-type="documentation" data-axiom-page-purpose="View the complete release history for Charlotte, including new features, changes, fixes, and removals for each version.">
      {/* Nav */}
      <nav aria-label="Site navigation" className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-sm border-b border-surface-border">
        <div className="max-w-5xl mx-auto px-6 sm:px-8 lg:px-12 h-14 flex items-center justify-between">
          <Link href="/" className="font-mono font-bold text-foreground">
            charlotte
          </Link>
          <div className="flex items-center gap-6 text-sm text-muted">
            <Link href="/" className="hover:text-foreground transition-colors">
              Home
            </Link>
            <Link href="/vs-playwright" className="hover:text-foreground transition-colors">
              Compare
            </Link>
            <a
              href="https://github.com/TickTockBent/charlotte"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted hover:text-foreground transition-colors"
              aria-label="GitHub repository"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
            </a>
          </div>
        </div>
      </nav>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Home", item: "https://charlotte-rose.vercel.app/" },
              { "@type": "ListItem", position: 2, name: "Changelog", item: "https://charlotte-rose.vercel.app/changelog/" },
            ],
          }),
        }}
      />

      {/* Content */}
      <main className="max-w-5xl mx-auto px-6 sm:px-8 lg:px-12 pt-28 pb-20">
        <nav aria-label="Breadcrumb" className="text-sm text-muted mb-6">
          <ol className="flex items-center gap-1.5">
            <li><Link href="/" className="hover:text-foreground transition-colors">Home</Link></li>
            <li aria-hidden="true" className="text-surface-border">/</li>
            <li aria-current="page" className="text-foreground">Changelog</li>
          </ol>
        </nav>
        <h1 className="text-3xl sm:text-4xl font-bold mb-2">Changelog</h1>
        <p className="text-muted mb-12">
          All notable changes to Charlotte, documented by release.
        </p>

        <div className="space-y-16">
          {releases.map((release) => (
            <section key={release.version} id={`v${release.version}`}>
              <div className="flex items-baseline gap-4 mb-6">
                <h2 className="text-xl font-bold font-mono text-accent">
                  v{release.version}
                </h2>
                <time dateTime={release.date} className="text-sm text-muted">{release.date}</time>
              </div>

              <div className="space-y-3">
                {release.entries.map((entry, entryIndex) => (
                  <div
                    key={entryIndex}
                    className="flex gap-3 items-start"
                  >
                    <span
                      className={`inline-flex items-center shrink-0 mt-0.5 px-2 py-0.5 text-xs font-mono font-medium rounded border ${typeBadgeClass[entry.type]}`}
                    >
                      {entry.type}
                    </span>
                    <p className="text-sm text-foreground/90 leading-relaxed">
                      {entry.text}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="py-12 px-6 sm:px-8 lg:px-12 border-t border-surface-border">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4 text-sm text-muted">
            <a href="https://github.com/TickTockBent/charlotte" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">GitHub</a>
            <span className="text-surface-border">|</span>
            <a href="https://www.npmjs.com/package/@ticktockbent/charlotte" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">npm</a>
            <span className="text-surface-border">|</span>
            <a href="https://github.com/TickTockBent/charlotte/blob/main/LICENSE" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">MIT License</a>
          </div>
          <p className="text-sm text-muted">Built with Charlotte.</p>
        </div>
      </footer>
    </div>
  );
}
