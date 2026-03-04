import type { Metadata } from "next";
import Link from "next/link";
import Footer from "../../components/Footer";

export const metadata: Metadata = {
  title: "Charlotte vs Playwright MCP — Head-to-Head Comparison",
  description:
    "Detailed comparison of Charlotte and Playwright MCP servers with real benchmark data. See how a token-efficient browser MCP reduces AI agent costs by up to 99%.",
  keywords: [
    "playwright mcp alternative",
    "playwright mcp vs",
    "token efficient browser mcp",
    "mcp server comparison",
    "charlotte mcp",
    "browser automation mcp",
    "ai agent browser tool",
    "model context protocol browser",
  ],
  openGraph: {
    title: "Charlotte vs Playwright MCP — Benchmark Comparison",
    description:
      "Head-to-head benchmarks: Charlotte returns 25-182x less data than Playwright MCP on real websites. Actual numbers from Wikipedia, GitHub, Hacker News, and LinkedIn.",
    type: "article",
    url: "https://charlotte-rose.vercel.app/vs-playwright/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Charlotte vs Playwright MCP — Benchmark Comparison",
    description:
      "Charlotte returns 25-182x less data than Playwright MCP. Real benchmarks, real numbers.",
  },
  alternates: {
    canonical: "https://charlotte-rose.vercel.app/vs-playwright/",
  },
};

const navigationBenchmarks = [
  {
    site: "Wikipedia (AI article)",
    charlotte: "7,667",
    playwright: "1,040,636",
    charlotteNum: 7667,
    playwrightNum: 1040636,
    factor: "136x smaller",
    reduction: "99.3%",
  },
  {
    site: "Hacker News",
    charlotte: "336",
    playwright: "61,230",
    charlotteNum: 336,
    playwrightNum: 61230,
    factor: "182x smaller",
    reduction: "99.5%",
  },
  {
    site: "GitHub repository",
    charlotte: "3,185",
    playwright: "80,297",
    charlotteNum: 3185,
    playwrightNum: 80297,
    factor: "25x smaller",
    reduction: "96.0%",
  },
  {
    site: "LinkedIn (logged out)",
    charlotte: "3,404",
    playwright: "24,712",
    charlotteNum: 3404,
    playwrightNum: 24712,
    factor: "7.3x smaller",
    reduction: "86.2%",
  },
];

const costBenchmarks = [
  {
    model: "Claude Sonnet 4",
    charlotte: "$0.05",
    playwright: "$9.18",
    savings: "$9.13",
  },
  {
    model: "Claude Opus 4",
    charlotte: "$0.09",
    playwright: "$15.30",
    savings: "$15.21",
  },
  { model: "GPT-4o", charlotte: "$0.04", playwright: "$7.65", savings: "$7.61" },
  {
    model: "Claude Haiku 4",
    charlotte: "$0.01",
    playwright: "$2.45",
    savings: "$2.43",
  },
];

type FeatureSupport = "yes" | "no" | "partial";

interface FeatureRow {
  feature: string;
  charlotte: FeatureSupport;
  playwright: FeatureSupport;
  note?: string;
}

const featureMatrix: FeatureRow[] = [
  {
    feature: "Detail level control",
    charlotte: "yes",
    playwright: "no",
    note: "3 tiers: minimal, summary, full",
  },
  {
    feature: "Stable hash-based element IDs",
    charlotte: "yes",
    playwright: "no",
    note: "Survives DOM mutations",
  },
  {
    feature: "Structural diff tool",
    charlotte: "yes",
    playwright: "no",
    note: "Compare snapshots between actions",
  },
  {
    feature: "Semantic find",
    charlotte: "yes",
    playwright: "no",
    note: "Search by text, role, or type",
  },
  {
    feature: "Form structure extraction",
    charlotte: "yes",
    playwright: "no",
    note: "Grouped fields with labels and options",
  },
  {
    feature: "Accessibility audits",
    charlotte: "yes",
    playwright: "no",
    note: "Built-in a11y analysis",
  },
  {
    feature: "Tiered tool profiles",
    charlotte: "yes",
    playwright: "no",
    note: "Load only the tools you need",
  },
  {
    feature: "Element bounding boxes",
    charlotte: "yes",
    playwright: "no",
    note: "Layout geometry per element",
  },
  {
    feature: "Async condition polling",
    charlotte: "yes",
    playwright: "yes",
  },
  {
    feature: "Console message retrieval",
    charlotte: "yes",
    playwright: "yes",
  },
  {
    feature: "Network request monitoring",
    charlotte: "yes",
    playwright: "yes",
  },
  { feature: "Dialog handling", charlotte: "yes", playwright: "yes" },
  { feature: "Drag and drop", charlotte: "yes", playwright: "yes" },
  {
    feature: "Tab management",
    charlotte: "yes",
    playwright: "yes",
    note: "Open, switch, close tabs",
  },
  { feature: "JavaScript evaluation", charlotte: "yes", playwright: "yes" },
  { feature: "Screenshot capture", charlotte: "yes", playwright: "yes" },
  {
    feature: "File upload",
    charlotte: "no",
    playwright: "yes",
    note: "Planned for future release",
  },
  {
    feature: "Coordinate-based interaction",
    charlotte: "no",
    playwright: "yes",
    note: "Vision group (6 tools)",
  },
  { feature: "PDF generation", charlotte: "no", playwright: "yes" },
  {
    feature: "Testing assertions",
    charlotte: "no",
    playwright: "yes",
    note: "5 verification tools",
  },
  {
    feature: "Multi-browser engines",
    charlotte: "no",
    playwright: "yes",
    note: "Chrome, Firefox, WebKit",
  },
  { feature: "Trace recording", charlotte: "no", playwright: "yes" },
];

function SupportBadge({ support }: { support: FeatureSupport }) {
  if (support === "yes") {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-400">
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M13.5 4.5L6 12L2.5 8.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Yes
      </span>
    );
  }
  if (support === "no") {
    return (
      <span className="inline-flex items-center gap-1 text-muted/60">
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M4 4L12 12M12 4L4 12"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        No
      </span>
    );
  }
  return <span className="text-amber-400">Partial</span>;
}

function ComparisonBar({
  label,
  charlotteValue,
  playwrightValue,
  charlotteNum,
  playwrightNum,
  factor,
}: {
  label: string;
  charlotteValue: string;
  playwrightValue: string;
  charlotteNum: number;
  playwrightNum: number;
  factor: string;
}) {
  const maxValue = Math.max(charlotteNum, playwrightNum);
  const charlottePercent = Math.max((charlotteNum / maxValue) * 100, 1);
  const playwrightPercent = Math.max((playwrightNum / maxValue) * 100, 1);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-foreground font-medium">{label}</span>
        <span className="text-xs text-accent font-mono">{factor}</span>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted w-16 text-right shrink-0">
            Charlotte
          </span>
          <div className="flex-1 h-5 bg-surface rounded overflow-hidden">
            <div
              className="h-full bg-accent/60 rounded flex items-center justify-end pr-2"
              style={{
                width: `${charlottePercent}%`,
                minWidth: "fit-content",
              }}
            >
              <span className="text-[10px] font-mono text-foreground whitespace-nowrap">
                {charlotteValue}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted w-16 text-right shrink-0">
            Playwright
          </span>
          <div className="flex-1 h-5 bg-surface rounded overflow-hidden">
            <div
              className="h-full bg-muted/30 rounded flex items-center justify-end pr-2"
              style={{
                width: `${playwrightPercent}%`,
                minWidth: "fit-content",
              }}
            >
              <span className="text-[10px] font-mono text-foreground whitespace-nowrap">
                {playwrightValue}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VsPlaywrightPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "Charlotte vs Playwright MCP — Head-to-Head Comparison",
    description:
      "Detailed comparison of Charlotte and Playwright MCP servers with real benchmark data.",
    datePublished: "2026-03-04",
    dateModified: "2026-03-04",
    author: {
      "@type": "Organization",
      name: "Charlotte",
      url: "https://charlotte-rose.vercel.app",
    },
    publisher: {
      "@type": "Organization",
      name: "Charlotte",
      url: "https://charlotte-rose.vercel.app",
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": "https://charlotte-rose.vercel.app/vs-playwright/",
    },
  };

  return (
    <div className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-sm border-b border-surface-border">
        <div className="max-w-5xl mx-auto px-6 sm:px-8 lg:px-12 h-14 flex items-center justify-between">
          <Link href="/" className="font-mono font-bold text-foreground">
            charlotte
          </Link>
          <div className="flex items-center gap-6 text-sm text-muted">
            <Link
              href="/"
              className="hover:text-foreground transition-colors"
            >
              Home
            </Link>
            <Link
              href="/changelog"
              className="hover:text-foreground transition-colors"
            >
              Changelog
            </Link>
            <a
              href="https://github.com/TickTockBent/charlotte"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted hover:text-foreground transition-colors"
              aria-label="GitHub repository"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
            </a>
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-6 sm:px-8 lg:px-12 pt-28 pb-20">
        {/* Hero */}
        <header className="mb-16">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
            Charlotte vs Playwright MCP
          </h1>
          <p className="text-lg text-muted max-w-3xl leading-relaxed">
            Both Charlotte and Playwright MCP give AI agents the ability to
            browse the web. The difference is cost. Charlotte is a
            token-efficient browser MCP that returns 25&ndash;182x less data on
            real websites &mdash; saving thousands of dollars across production
            workloads.
          </p>
        </header>

        {/* The problem */}
        <section className="mb-16" aria-labelledby="problem-heading">
          <h2
            id="problem-heading"
            className="text-2xl font-bold tracking-tight mb-4"
          >
            Why response size matters
          </h2>
          <div className="prose-sm text-foreground/90 space-y-4 max-w-3xl leading-relaxed">
            <p>
              Every character an MCP server returns enters the AI agent&apos;s
              context window as input tokens. Playwright MCP sends the full
              accessibility snapshot on every call &mdash; whether the agent
              needs the entire page or just a single button. On a Wikipedia
              article, that&apos;s over a million characters per navigation.
            </p>
            <p>
              Charlotte takes a different approach. It defaults to{" "}
              <strong>minimal detail</strong> on navigation &mdash; a compact
              summary with interactive element counts per landmark region. When
              the agent needs more, it asks for it with{" "}
              <code className="text-accent font-mono text-xs">observe</code> or{" "}
              <code className="text-accent font-mono text-xs">find</code>. This
              demand-driven model means agents only pay for the context they
              actually use.
            </p>
            <p>
              If you&apos;re evaluating a Playwright MCP alternative for
              cost-sensitive or high-volume agent workflows, the numbers below
              tell the story.
            </p>
          </div>
        </section>

        {/* Navigation benchmarks */}
        <section className="mb-16" aria-labelledby="benchmarks-heading">
          <h2
            id="benchmarks-heading"
            className="text-2xl font-bold tracking-tight mb-4"
          >
            Response size: navigate
          </h2>
          <p className="text-sm text-muted mb-8 max-w-2xl">
            Characters returned when an agent first lands on a page. Charlotte
            defaults to minimal detail; Playwright returns the full accessibility
            tree. Measured on Charlotte v0.2.0 and Playwright MCP v1.0.
          </p>

          <div className="space-y-6">
            {navigationBenchmarks.map((row) => (
              <ComparisonBar
                key={row.site}
                label={row.site}
                charlotteValue={row.charlotte}
                playwrightValue={row.playwright}
                charlotteNum={row.charlotteNum}
                playwrightNum={row.playwrightNum}
                factor={row.factor}
              />
            ))}
          </div>

          <div className="mt-8 p-5 rounded-lg border border-accent/20 bg-accent/5">
            <p className="text-sm text-foreground leading-relaxed">
              <span className="font-semibold text-accent">
                What this means in practice:
              </span>{" "}
              A Playwright agent reading Hacker News headlines receives 61,230
              characters of accessibility tree data. A Charlotte agent gets 336
              characters &mdash; enough to see the page structure and landmarks
              &mdash; then calls{" "}
              <code className="font-mono text-accent text-xs">
                find({`{ type: "link" }`})
              </code>{" "}
              to retrieve exactly the links it needs. The agent decides what
              level of detail is worth paying for.
            </p>
          </div>
        </section>

        {/* Cost comparison */}
        <section className="mb-16" aria-labelledby="cost-heading">
          <h2
            id="cost-heading"
            className="text-2xl font-bold tracking-tight mb-4"
          >
            Cost per 100-page session
          </h2>
          <p className="text-sm text-muted mb-8 max-w-2xl">
            Input token cost for a 100-page browsing session at Hacker News
            complexity. Charlotte uses the default browse profile (22 tools);
            Playwright loads all tools on every call.
          </p>

          <div className="rounded-lg border border-surface-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border bg-surface">
                  <th className="text-left py-3 px-4 text-muted font-medium">
                    Model
                  </th>
                  <th className="text-right py-3 px-4 text-accent font-medium">
                    Charlotte
                  </th>
                  <th className="text-right py-3 px-4 text-muted font-medium">
                    Playwright
                  </th>
                  <th className="text-right py-3 px-4 text-muted font-medium">
                    You save
                  </th>
                </tr>
              </thead>
              <tbody>
                {costBenchmarks.map((row) => (
                  <tr
                    key={row.model}
                    className="border-b border-surface-border last:border-0"
                  >
                    <td className="py-3 px-4 text-foreground">{row.model}</td>
                    <td className="py-3 px-4 text-right font-mono text-accent">
                      {row.charlotte}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-muted">
                      {row.playwright}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-foreground font-medium">
                      {row.savings}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-3 bg-surface text-xs text-muted">
              Input token costs only. 100 navigate calls at Hacker News page
              complexity.
            </div>
          </div>

          <p className="mt-6 text-sm text-muted max-w-2xl">
            With tiered tool profiles, Charlotte further reduces overhead.
            The default <strong>browse</strong> profile loads 22 tools instead of 40,
            cutting tool definition tokens by 48%. The <strong>core</strong>{" "}
            profile (7 tools) cuts definition overhead by 77%.
          </p>
        </section>

        {/* Feature comparison */}
        <section className="mb-16" aria-labelledby="features-heading">
          <h2
            id="features-heading"
            className="text-2xl font-bold tracking-tight mb-4"
          >
            Feature comparison
          </h2>
          <p className="text-sm text-muted mb-8 max-w-2xl">
            Charlotte v0.4.0 (40 tools) vs Playwright MCP (36 tools).
            Both are open-source MCP servers for browser automation. The
            capability overlap is substantial &mdash; the difference is in
            design philosophy.
          </p>

          <div className="rounded-lg border border-surface-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-border bg-surface">
                    <th className="text-left py-3 px-4 text-muted font-medium">
                      Feature
                    </th>
                    <th className="text-center py-3 px-4 text-accent font-medium w-28">
                      Charlotte
                    </th>
                    <th className="text-center py-3 px-4 text-muted font-medium w-28">
                      Playwright
                    </th>
                    <th className="text-left py-3 px-4 text-muted font-medium hidden sm:table-cell">
                      Notes
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {featureMatrix.map((row) => (
                    <tr
                      key={row.feature}
                      className="border-b border-surface-border last:border-0"
                    >
                      <td className="py-2.5 px-4 text-foreground">
                        {row.feature}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <SupportBadge support={row.charlotte} />
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <SupportBadge support={row.playwright} />
                      </td>
                      <td className="py-2.5 px-4 text-muted text-xs hidden sm:table-cell">
                        {row.note || ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Where each wins */}
        <section className="mb-16" aria-labelledby="tradeoffs-heading">
          <h2
            id="tradeoffs-heading"
            className="text-2xl font-bold tracking-tight mb-4"
          >
            Where each tool wins
          </h2>

          <div className="grid sm:grid-cols-2 gap-6">
            {/* Charlotte wins */}
            <div className="rounded-lg border border-accent/20 bg-accent/5 p-6">
              <h3 className="text-lg font-semibold text-accent mb-4">
                Choose Charlotte when
              </h3>
              <ul className="space-y-3 text-sm text-foreground/90">
                <li className="flex gap-2">
                  <span className="text-accent shrink-0 mt-0.5">&#x2022;</span>
                  <span>
                    <strong>Token cost matters.</strong> Long browsing sessions,
                    high-volume pipelines, or expensive models where every input
                    token adds up.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="text-accent shrink-0 mt-0.5">&#x2022;</span>
                  <span>
                    <strong>Agents need surgical precision.</strong> Semantic
                    find, detail levels, and structural diffs let agents request
                    exactly the data they need instead of parsing a full page
                    dump.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="text-accent shrink-0 mt-0.5">&#x2022;</span>
                  <span>
                    <strong>Accessibility is a priority.</strong> Built-in a11y
                    audits and form structure extraction help agents understand
                    page semantics, not just raw DOM.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="text-accent shrink-0 mt-0.5">&#x2022;</span>
                  <span>
                    <strong>You want stable references.</strong> Hash-based
                    element IDs survive re-renders. No more broken selectors when
                    the DOM shifts.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="text-accent shrink-0 mt-0.5">&#x2022;</span>
                  <span>
                    <strong>Context window headroom.</strong> Smaller responses
                    leave more room for agent reasoning, tool results from other
                    sources, and longer conversations.
                  </span>
                </li>
              </ul>
            </div>

            {/* Playwright wins */}
            <div className="rounded-lg border border-surface-border bg-surface/50 p-6">
              <h3 className="text-lg font-semibold text-foreground mb-4">
                Choose Playwright MCP when
              </h3>
              <ul className="space-y-3 text-sm text-foreground/90">
                <li className="flex gap-2">
                  <span className="text-muted shrink-0 mt-0.5">&#x2022;</span>
                  <span>
                    <strong>You need file uploads.</strong> Playwright MCP has a
                    dedicated file upload tool. Charlotte doesn&apos;t yet.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="text-muted shrink-0 mt-0.5">&#x2022;</span>
                  <span>
                    <strong>Cross-browser testing matters.</strong> Playwright
                    supports Chrome, Firefox, and WebKit. Charlotte runs on
                    Chromium only.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="text-muted shrink-0 mt-0.5">&#x2022;</span>
                  <span>
                    <strong>Vision-based interaction.</strong> Playwright&apos;s
                    vision group provides coordinate-based tools for canvas
                    elements and non-accessible UIs.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="text-muted shrink-0 mt-0.5">&#x2022;</span>
                  <span>
                    <strong>You need trace recording.</strong> Playwright can
                    record browser traces and video for debugging test failures.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="text-muted shrink-0 mt-0.5">&#x2022;</span>
                  <span>
                    <strong>Built-in test assertions.</strong> Five verification
                    tools for checking element visibility, text content, and
                    values.
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* Design philosophy */}
        <section className="mb-16" aria-labelledby="philosophy-heading">
          <h2
            id="philosophy-heading"
            className="text-2xl font-bold tracking-tight mb-4"
          >
            Different design, different strengths
          </h2>
          <div className="prose-sm text-foreground/90 space-y-4 max-w-3xl leading-relaxed">
            <p>
              Playwright MCP was built by the Playwright team to expose their
              browser automation engine over MCP. It gives agents the full page
              state on every call &mdash; comprehensive, but expensive when the
              agent only needs a fraction of it.
            </p>
            <p>
              Charlotte was designed from scratch as a token-efficient browser
              MCP. Every response is structured around what agents actually need
              at each step: a minimal overview on arrival, targeted queries for
              specific elements, and full detail only when explicitly requested.
              This demand-driven model can reduce input token costs by 96&ndash;99%
              on content-heavy pages.
            </p>
            <p>
              Charlotte also introduces capabilities that Playwright MCP
              doesn&apos;t offer: structural diffs between page states, semantic
              search across the accessibility tree, form structure extraction
              with grouped fields and labels, and tiered tool profiles that
              reduce tool definition overhead by up to 77%.
            </p>
          </div>
        </section>

        {/* Tool definition overhead */}
        <section className="mb-16" aria-labelledby="profiles-heading">
          <h2
            id="profiles-heading"
            className="text-2xl font-bold tracking-tight mb-4"
          >
            Tool definition overhead
          </h2>
          <p className="text-sm text-muted mb-8 max-w-2xl">
            MCP tool definitions are sent as input tokens on every API call.
            More tools means higher per-call overhead &mdash; even when the
            agent doesn&apos;t use them. Charlotte&apos;s tiered profiles let
            you control this cost.
          </p>

          <div className="rounded-lg border border-surface-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border bg-surface">
                  <th className="text-left py-3 px-4 text-muted font-medium">
                    Configuration
                  </th>
                  <th className="text-right py-3 px-4 text-muted font-medium">
                    Tools
                  </th>
                  <th className="text-right py-3 px-4 text-muted font-medium">
                    Tokens/call
                  </th>
                  <th className="text-right py-3 px-4 text-muted font-medium">
                    vs Full
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-surface-border">
                  <td className="py-3 px-4 text-foreground">
                    Charlotte full
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-muted">
                    40
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-muted">
                    7,187
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-muted">
                    &mdash;
                  </td>
                </tr>
                <tr className="border-b border-surface-border">
                  <td className="py-3 px-4 text-foreground">
                    Charlotte browse{" "}
                    <span className="text-xs text-accent">(default)</span>
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-accent">
                    22
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-accent">
                    3,727
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-foreground font-medium">
                    48% less
                  </td>
                </tr>
                <tr>
                  <td className="py-3 px-4 text-foreground">Charlotte core</td>
                  <td className="py-3 px-4 text-right font-mono text-accent">
                    7
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-accent">
                    1,677
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-foreground font-medium">
                    77% less
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="px-4 py-3 bg-surface text-xs text-muted">
              Token estimates based on definition character count / 3.5
              (schema-dense JSON). Playwright MCP does not offer tool subsetting.
            </div>
          </div>
        </section>

        {/* Getting started */}
        <section className="mb-16" aria-labelledby="start-heading">
          <h2
            id="start-heading"
            className="text-2xl font-bold tracking-tight mb-4"
          >
            Try Charlotte
          </h2>
          <p className="text-sm text-muted mb-6 max-w-2xl">
            Charlotte is open-source, MIT-licensed, and available on npm. Add it
            to any MCP-compatible client in one step.
          </p>

          <div className="rounded-lg border border-surface-border bg-surface p-5 font-mono text-sm max-w-xl">
            <div className="text-muted mb-1"># Install</div>
            <div className="text-foreground">
              npx @ticktockbent/charlotte@latest
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-4 text-sm">
            <Link
              href="/"
              className="text-accent hover:text-accent/80 transition-colors"
            >
              Full documentation &rarr;
            </Link>
            <a
              href="https://github.com/TickTockBent/charlotte"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:text-accent/80 transition-colors"
            >
              GitHub repository &rarr;
            </a>
            <a
              href="https://github.com/TickTockBent/charlotte/blob/main/docs/charlotte-benchmark-report.md"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:text-accent/80 transition-colors"
            >
              Full benchmark methodology &rarr;
            </a>
          </div>
        </section>

        {/* FAQ / natural keyword section */}
        <section aria-labelledby="faq-heading">
          <h2
            id="faq-heading"
            className="text-2xl font-bold tracking-tight mb-8"
          >
            Common questions
          </h2>

          <div className="space-y-8 max-w-3xl">
            <div>
              <h3 className="text-base font-semibold text-foreground mb-2">
                Is Charlotte a drop-in replacement for Playwright MCP?
              </h3>
              <p className="text-sm text-foreground/90 leading-relaxed">
                Not exactly. Charlotte uses different tool names and a different
                response format. But the core workflow is the same: navigate to
                a URL, observe the page, interact with elements. Most agents
                adapt to Charlotte&apos;s tools naturally since MCP clients
                discover capabilities at connection time. The main functional
                gaps are file upload, multi-browser support, and
                coordinate-based vision tools.
              </p>
            </div>

            <div>
              <h3 className="text-base font-semibold text-foreground mb-2">
                How much does Charlotte actually save on tokens?
              </h3>
              <p className="text-sm text-foreground/90 leading-relaxed">
                On navigation, Charlotte returns 25&ndash;182x fewer characters
                than Playwright MCP depending on page complexity. For a
                100-page browsing session on Claude Sonnet 4, that&apos;s $0.05
                vs $9.18 in input token costs. Content-heavy pages like
                Wikipedia see the largest gains (136x smaller). Simple pages
                like example.com show modest improvement (1.3x). Real-world
                pages consistently fall in the 7&ndash;182x range.
              </p>
            </div>

            <div>
              <h3 className="text-base font-semibold text-foreground mb-2">
                Can I use Charlotte with Claude, GPT-4, or other LLMs?
              </h3>
              <p className="text-sm text-foreground/90 leading-relaxed">
                Yes. Charlotte implements the standard Model Context Protocol.
                Any MCP-compatible client works: Claude Desktop, Claude Code,
                Cursor, Windsurf, Cline, or custom MCP clients. The server
                communicates over stdio and doesn&apos;t depend on any specific
                LLM provider.
              </p>
            </div>

            <div>
              <h3 className="text-base font-semibold text-foreground mb-2">
                What makes this different from other browser MCP servers?
              </h3>
              <p className="text-sm text-foreground/90 leading-relaxed">
                Charlotte was purpose-built for token efficiency. The
                demand-driven detail model, stable hash-based element IDs,
                structural diffing, semantic find, and tiered tool profiles are
                all designed to minimize the tokens agents spend on browsing.
                Most browser MCP servers, including Playwright MCP, send the
                full page state on every call regardless of what the agent
                needs.
              </p>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
