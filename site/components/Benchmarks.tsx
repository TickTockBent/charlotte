"use client";

import { useState } from "react";

type Tab = "navigate" | "observe" | "cost";

const navigateData = [
  { site: "Wikipedia (AI)", charlotte: "22,134", playwright: "1,137,928", factor: "51x smaller" },
  { site: "Hacker News", charlotte: "364", playwright: "50,706", factor: "139x smaller" },
  { site: "GitHub repo", charlotte: "3,778", playwright: "38,983", factor: "10x smaller" },
  { site: "example.com", charlotte: "415", playwright: "465", factor: "1.1x smaller" },
];

const observeData = [
  { site: "Wikipedia (AI)", charlotte: "521,127", playwright: "1,040,878", factor: "2x smaller" },
  { site: "Hacker News", charlotte: "30,781", playwright: "61,143", factor: "2x smaller" },
  { site: "GitHub repo", charlotte: "37,628", playwright: "80,190", factor: "2.1x smaller" },
  { site: "example.com", charlotte: "612", playwright: "498", factor: "comparable" },
];

const costData = [
  { model: "Claude Sonnet 5", charlotte: "$0.03", playwright: "$3.82", savings: "$3.80" },
  { model: "Claude Opus 5", charlotte: "$0.05", playwright: "$6.37", savings: "$6.33" },
  { model: "GPT-5.6 Terra", charlotte: "$0.02", playwright: "$2.55", savings: "$2.53" },
  { model: "Claude Haiku 4.5", charlotte: "$0.01", playwright: "$1.27", savings: "$1.27" },
];

function BarComparison({
  label,
  charlotteValue,
  playwrightValue,
  factor,
}: {
  label: string;
  charlotteValue: string;
  playwrightValue: string;
  factor: string;
}) {
  const charlotteNumber = parseInt(charlotteValue.replace(/,/g, ""), 10);
  const playwrightNumber = parseInt(playwrightValue.replace(/,/g, ""), 10);
  const maxValue = Math.max(charlotteNumber, playwrightNumber);
  const charlottePercent = Math.max((charlotteNumber / maxValue) * 100, 1);
  const playwrightPercent = Math.max((playwrightNumber / maxValue) * 100, 1);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-foreground font-medium">{label}</span>
        <span className="text-xs text-accent font-mono">{factor}</span>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted w-16 text-right shrink-0">Charlotte</span>
          <div className="flex-1 h-5 bg-surface rounded overflow-hidden">
            <div
              className="h-full bg-accent/60 rounded flex items-center justify-end pr-2"
              style={{ width: `${charlottePercent}%`, minWidth: "fit-content" }}
            >
              <span className="text-[10px] font-mono text-foreground whitespace-nowrap">{charlotteValue}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted w-16 text-right shrink-0">Playwright</span>
          <div className="flex-1 h-5 bg-surface rounded overflow-hidden">
            <div
              className="h-full bg-muted/30 rounded flex items-center justify-end pr-2"
              style={{ width: `${playwrightPercent}%`, minWidth: "fit-content" }}
            >
              <span className="text-[10px] font-mono text-foreground whitespace-nowrap">{playwrightValue}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Benchmarks() {
  const [activeTab, setActiveTab] = useState<Tab>("navigate");

  const tabs: { key: Tab; label: string; description: string }[] = [
    {
      key: "navigate",
      label: "Navigate",
      description: "Characters returned when an agent first lands on a page. Charlotte defaults to minimal detail; Playwright returns the full accessibility tree.",
    },
    {
      key: "observe",
      label: "Observe",
      description: "Characters returned when an agent explicitly requests full page detail. Charlotte at summary detail vs Playwright snapshot.",
    },
    {
      key: "cost",
      label: "Cost",
      description: "API input token cost for a 100-page browsing session. Hacker News complexity as representative average.",
    },
  ];

  const activeTabInfo = tabs.find((t) => t.key === activeTab)!;

  return (
    <section id="benchmarks" className="py-20 px-6 sm:px-8 lg:px-12 border-t border-surface-border" data-asm-role="primary-content" data-asm-summary="Performance benchmarks comparing Charlotte vs Playwright MCP response sizes and token costs across real websites." data-asm-priority="high">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl font-bold tracking-tight mb-4">
          Benchmarks
        </h2>
        <p className="text-muted text-lg mb-10 max-w-3xl">
          Charlotte v0.8.0 vs Playwright MCP v0.0.79 on real websites, measured 2026-08-08. Every character an MCP server returns
          enters the agent&apos;s context window — smaller responses mean lower costs, more room for
          reasoning, and longer browsing sessions.
        </p>

        {/* Tabs */}
        <div role="tablist" aria-label="Benchmark categories" className="flex gap-1 p-1 rounded-lg bg-surface border border-surface-border mb-8 w-fit">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={activeTab === tab.key}
              aria-controls={`benchmark-panel-${tab.key}`}
              id={`benchmark-tab-${tab.key}`}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? "bg-accent/10 text-accent"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab description */}
        <p className="text-sm text-muted mb-6 max-w-2xl">
          {activeTabInfo.description}
        </p>

        {/* Navigate tab */}
        {activeTab === "navigate" && (
          <div role="tabpanel" id="benchmark-panel-navigate" aria-labelledby="benchmark-tab-navigate" className="space-y-6">
            {navigateData.map((row) => (
              <BarComparison
                key={row.site}
                label={row.site}
                charlotteValue={row.charlotte}
                playwrightValue={row.playwright}
                factor={row.factor}
              />
            ))}
          </div>
        )}

        {/* Observe tab */}
        {activeTab === "observe" && (
          <div role="tabpanel" id="benchmark-panel-observe" aria-labelledby="benchmark-tab-observe" className="space-y-6">
            {observeData.map((row) => (
              <BarComparison
                key={row.site}
                label={row.site}
                charlotteValue={row.charlotte}
                playwrightValue={row.playwright}
                factor={row.factor}
              />
            ))}
          </div>
        )}

        {/* Cost tab */}
        {activeTab === "cost" && (
          <div role="tabpanel" id="benchmark-panel-cost" aria-labelledby="benchmark-tab-cost" className="rounded-lg border border-surface-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border bg-surface">
                  <th className="text-left py-3 px-4 text-muted font-medium">Model</th>
                  <th className="text-right py-3 px-4 text-accent font-medium">Charlotte</th>
                  <th className="text-right py-3 px-4 text-muted font-medium">Playwright</th>
                  <th className="text-right py-3 px-4 text-muted font-medium">You save</th>
                </tr>
              </thead>
              <tbody>
                {costData.map((row) => (
                  <tr key={row.model} className="border-b border-surface-border last:border-0">
                    <td className="py-3 px-4 text-foreground">{row.model}</td>
                    <td className="py-3 px-4 text-right font-mono text-accent">{row.charlotte}</td>
                    <td className="py-3 px-4 text-right font-mono text-muted">{row.playwright}</td>
                    <td className="py-3 px-4 text-right font-mono text-foreground font-medium">{row.savings}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-3 bg-surface text-xs text-muted">
              100 page navigations at Hacker News complexity. Input token costs only.
            </div>
          </div>
        )}

        {/* Callout */}
        <div className="mt-10 p-6 rounded-lg border border-accent/20 bg-accent/5">
          <p className="text-sm text-foreground leading-relaxed">
            <span className="font-semibold text-accent">The workflow difference:</span>{" "}
            Playwright agents receive 50K+ characters every time they look at Hacker News — whether
            they&apos;re reading headlines or looking for a login button. Charlotte agents get 364
            characters on arrival, call{" "}
            <code className="font-mono text-accent text-xs">find({`{ type: "link", text: "login" }`})</code>{" "}
            to get exactly what they need, and never pay for the rest.
          </p>
        </div>

        {/* Link to full report */}
        <div className="mt-6">
          <a
            href="https://github.com/TickTockBent/charlotte/blob/main/docs/charlotte-benchmark-report.md"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-accent hover:text-accent/80 transition-colors"
          >
            Full benchmark report with methodology &rarr;
          </a>
        </div>
      </div>
    </section>
  );
}
