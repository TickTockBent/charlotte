// Canonical source for this data lives in benchmarks/results/ at the repo root
// (outside site/, which is the Vercel project root and the only tree that
// triggers a deploy). The release ritual: re-run the benchmarks, commit the
// results under benchmarks/results/, then copy the new dated JSON files into
// site/data/ and update the import below — that's what makes the site deploy
// pick up the new numbers.
import driftData from "@/data/drift-2026-08-09.json";

type VersionRow = (typeof driftData)["versions"][number];
type PageLabel = "Hacker News" | "Wikipedia" | "GitHub";

const PAGE_SERIES: { key: PageLabel; label: string; color: string }[] = [
  { key: "Hacker News", label: "Hacker News", color: "#0891b2" },
  { key: "Wikipedia", label: "Wikipedia", color: "#d95926" },
  { key: "GitHub", label: "GitHub", color: "#9085e9" },
];

const BASELINE_COLOR = "#a3a3a3";

// Chart geometry (viewBox units — the SVG scales responsively via width="100%")
const CHART_WIDTH = 720;
const CHART_HEIGHT = 300;
const MARGIN = { top: 20, right: 16, bottom: 40, left: 56 };
const PLOT_WIDTH = CHART_WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;

// Log y-axis: the Playwright baseline sits ~18x above the Charlotte band, so a
// linear axis would flatten every Charlotte release into a single line.
const Y_MIN = 50;
const Y_MAX = 18000;
const LOG_MIN = Math.log10(Y_MIN);
const LOG_MAX = Math.log10(Y_MAX);
const GRIDLINE_VALUES = [100, 1000, 10000];

function yForValue(value: number): number {
  const fraction = (Math.log10(value) - LOG_MIN) / (LOG_MAX - LOG_MIN);
  return MARGIN.top + PLOT_HEIGHT - fraction * PLOT_HEIGHT;
}

// 7 version columns plus extra spacing before the baseline column, which sits
// flush against the right edge in a visually separated position.
const GAP_UNITS = 1.4;

function buildXPositions(versionCount: number) {
  const totalUnits = versionCount - 1 + GAP_UNITS;
  const stepX = PLOT_WIDTH / totalUnits;
  const versionX = Array.from({ length: versionCount }, (_, i) => MARGIN.left + i * stepX);
  const baselineX = MARGIN.left + PLOT_WIDTH;
  return { versionX, baselineX, stepX };
}

function formatTokens(value: number): string {
  return value.toLocaleString("en-US");
}

export default function ReleaseDrift() {
  const versions: VersionRow[] = driftData.versions;
  const { versionX, baselineX, stepX } = buildXPositions(versions.length);

  const seriesPoints = PAGE_SERIES.map((series) => {
    const points = versions.map((version, i) => {
      const tokens = version.pages[series.key].run1.tokens;
      return { x: versionX[i], y: yForValue(tokens), tokens };
    });
    const baselineTokens = driftData.baseline.pages[series.key].run1.snapshot.tokens;
    const baselinePoint = { x: baselineX, y: yForValue(baselineTokens), tokens: baselineTokens };
    return { ...series, points, baselinePoint };
  });

  const separatorX = baselineX - stepX * 0.55;

  const maxDefTokens = Math.max(...versions.map((v) => v.defTokens), driftData.baseline.defTokens);

  const peakVersion = versions.reduce((max, v) => (v.defTokens > max.defTokens ? v : max), versions[0]);
  const latestVersion = versions[versions.length - 1];
  const firstVersion = versions[0];
  const defCutPercent = Math.round(
    ((peakVersion.defTokens - latestVersion.defTokens) / peakVersion.defTokens) * 100
  );

  return (
    <section className="mb-16" aria-labelledby="release-drift-heading">
      <h2 id="release-drift-heading" className="text-2xl font-bold tracking-tight mb-4">
        Release drift
      </h2>
      <p className="text-sm text-muted mb-8 max-w-2xl">
        Orientation cost (the <code className="text-accent font-mono text-xs">navigate</code>{" "}
        response) and tool-definition size for every Charlotte release, {firstVersion.version}
        &ndash;{latestVersion.version}, measured same-day against the same three live pages,
        alongside a same-day Playwright MCP {driftData.baseline.version} baseline.
      </p>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-4 text-xs text-muted">
        {PAGE_SERIES.map((series) => (
          <span key={series.key} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-0.5 rounded-full"
              style={{ backgroundColor: series.color }}
              aria-hidden="true"
            />
            {series.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block w-2 h-2 rotate-45"
            style={{ backgroundColor: BASELINE_COLOR }}
            aria-hidden="true"
          />
          Playwright {driftData.baseline.version} baseline
        </span>
      </div>

      <div className="rounded-lg border border-surface-border bg-surface/50 p-4">
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          width="100%"
          role="img"
          aria-labelledby="release-drift-svg-title"
          className="overflow-visible"
        >
          <title id="release-drift-svg-title">
            Navigate-response tokens per Charlotte release, three pages, log scale, with the
            Playwright baseline shown at right
          </title>

          {/* Baseline column highlight */}
          <rect
            x={separatorX}
            y={MARGIN.top}
            width={CHART_WIDTH - MARGIN.right - separatorX}
            height={PLOT_HEIGHT}
            className="fill-surface-border/30"
          />
          <line
            x1={separatorX}
            y1={MARGIN.top}
            x2={separatorX}
            y2={MARGIN.top + PLOT_HEIGHT}
            stroke="var(--surface-border)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />

          {/* Gridlines */}
          {GRIDLINE_VALUES.map((value) => {
            const y = yForValue(value);
            return (
              <g key={value}>
                <line
                  x1={MARGIN.left}
                  y1={y}
                  x2={CHART_WIDTH - MARGIN.right}
                  y2={y}
                  stroke="var(--surface-border)"
                  strokeWidth={1}
                />
                <text
                  x={MARGIN.left - 8}
                  y={y}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-muted"
                  fontSize={9}
                  fontFamily="var(--font-geist-mono), monospace"
                >
                  {formatTokens(value)}
                </text>
              </g>
            );
          })}

          {/* Series lines + points */}
          {seriesPoints.map((series) => (
            <g key={series.key}>
              <polyline
                points={series.points.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke={series.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {/* Dashed connector into the baseline — different measurement method, not a trend continuation */}
              <line
                x1={series.points[series.points.length - 1].x}
                y1={series.points[series.points.length - 1].y}
                x2={series.baselinePoint.x}
                y2={series.baselinePoint.y}
                stroke={series.color}
                strokeWidth={1.5}
                strokeDasharray="3 3"
                opacity={0.55}
              />
              {series.points.map((point, i) => {
                const isWikipedia = series.key === "Wikipedia";
                const isGitHub = series.key === "GitHub";
                const labelDy = isGitHub ? 15 : isWikipedia ? -8 : -8;
                return (
                  <g key={i}>
                    <circle cx={point.x} cy={point.y} r={3} fill={series.color}>
                      <title>
                        {versions[i].version} · {series.label}: {formatTokens(point.tokens)} tokens
                      </title>
                    </circle>
                    <text
                      x={point.x}
                      y={point.y + labelDy}
                      textAnchor="middle"
                      className="fill-muted"
                      fontSize={8}
                      fontFamily="var(--font-geist-mono), monospace"
                    >
                      {formatTokens(point.tokens)}
                    </text>
                  </g>
                );
              })}
              {/* Baseline marker (diamond) */}
              <rect
                x={series.baselinePoint.x - 4}
                y={series.baselinePoint.y - 4}
                width={8}
                height={8}
                transform={`rotate(45 ${series.baselinePoint.x} ${series.baselinePoint.y})`}
                fill={series.color}
                opacity={0.85}
              >
                <title>
                  Playwright {driftData.baseline.version} · {series.label}:{" "}
                  {formatTokens(series.baselinePoint.tokens)} tokens (browser_snapshot)
                </title>
              </rect>
            </g>
          ))}

          {/* X-axis labels */}
          {versions.map((version, i) => (
            <text
              key={version.version}
              x={versionX[i]}
              y={MARGIN.top + PLOT_HEIGHT + 16}
              textAnchor="middle"
              className="fill-muted"
              fontSize={9}
              fontFamily="var(--font-geist-mono), monospace"
            >
              {version.version}
            </text>
          ))}
          <text
            x={baselineX}
            y={MARGIN.top + PLOT_HEIGHT + 16}
            textAnchor="middle"
            className="fill-muted"
            fontSize={9}
            fontFamily="var(--font-geist-mono), monospace"
          >
            playwright
          </text>
          <text
            x={baselineX}
            y={MARGIN.top + PLOT_HEIGHT + 28}
            textAnchor="middle"
            className="fill-muted"
            fontSize={8}
            fontFamily="var(--font-geist-mono), monospace"
          >
            ({driftData.baseline.version})
          </text>
        </svg>

        {/* Baseline readout — kept as text rather than crowding the diamonds, since the
            three baseline points sit within ~20px of each other on the log scale. */}
        <p className="mt-3 text-xs text-muted font-mono">
          Playwright {driftData.baseline.version} baseline (browser_snapshot):{" "}
          {PAGE_SERIES.map((series, i) => (
            <span key={series.key}>
              {i > 0 && " · "}
              <span style={{ color: series.color }}>{series.label}</span>{" "}
              {formatTokens(driftData.baseline.pages[series.key].run1.snapshot.tokens)}
            </span>
          ))}
        </p>

        <details className="mt-4 text-xs text-muted">
          <summary className="cursor-pointer hover:text-foreground transition-colors">
            View chart data as a table
          </summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-surface-border">
                  <th className="text-left py-1.5 pr-4 font-medium">Version</th>
                  <th className="text-right py-1.5 pr-4 font-medium">Hacker News</th>
                  <th className="text-right py-1.5 pr-4 font-medium">Wikipedia</th>
                  <th className="text-right py-1.5 font-medium">GitHub</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((version) => (
                  <tr key={version.version} className="border-b border-surface-border last:border-0">
                    <td className="py-1.5 pr-4 text-foreground">{version.version}</td>
                    <td className="py-1.5 pr-4 text-right font-mono">
                      {formatTokens(version.pages["Hacker News"].run1.tokens)}
                    </td>
                    <td className="py-1.5 pr-4 text-right font-mono">
                      {formatTokens(version.pages["Wikipedia"].run1.tokens)}
                    </td>
                    <td className="py-1.5 text-right font-mono">
                      {formatTokens(version.pages["GitHub"].run1.tokens)}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="py-1.5 pr-4 text-foreground">
                    playwright ({driftData.baseline.version})
                  </td>
                  <td className="py-1.5 pr-4 text-right font-mono">
                    {formatTokens(driftData.baseline.pages["Hacker News"].run1.snapshot.tokens)}
                  </td>
                  <td className="py-1.5 pr-4 text-right font-mono">
                    {formatTokens(driftData.baseline.pages["Wikipedia"].run1.snapshot.tokens)}
                  </td>
                  <td className="py-1.5 text-right font-mono">
                    {formatTokens(driftData.baseline.pages["GitHub"].run1.snapshot.tokens)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </div>

      {/* Takeaway */}
      <div className="mt-6 p-5 rounded-lg border border-accent/20 bg-accent/5">
        <p className="text-sm text-foreground leading-relaxed">
          <span className="font-semibold text-accent">Takeaway:</span> orientation cost moved{" "}
          {formatTokens(firstVersion.pages["Hacker News"].run1.tokens)}&rarr;
          {formatTokens(latestVersion.pages["Hacker News"].run1.tokens)} tokens on Hacker News
          across six releases, while tool-definition size was cut by roughly {defCutPercent}% from
          its {peakVersion.version} peak ({formatTokens(peakVersion.defTokens)}&nbsp;&rarr;&nbsp;
          {formatTokens(latestVersion.defTokens)} tokens) and has held roughly flat since.
        </p>
      </div>

      {/* Tool-definition size per version */}
      <div className="mt-10">
        <h3 className="text-base font-semibold text-foreground mb-4">
          Tool-definition size per version
        </h3>
        <div className="space-y-2">
          {versions.map((version) => {
            const percent = Math.max((version.defTokens / maxDefTokens) * 100, 1);
            return (
              <div key={version.version} className="flex items-center gap-3">
                <span className="text-xs text-muted w-20 shrink-0 font-mono">{version.version}</span>
                <div className="flex-1 h-5 bg-surface rounded overflow-hidden">
                  <div
                    className="h-full bg-accent/60 rounded flex items-center justify-end pr-2"
                    style={{ width: `${percent}%`, minWidth: "fit-content" }}
                  >
                    <span className="text-[10px] font-mono text-foreground whitespace-nowrap">
                      {formatTokens(version.defTokens)}
                    </span>
                  </div>
                </div>
                <span className="text-xs text-muted w-16 shrink-0 text-right">
                  {version.toolCount} tools
                </span>
              </div>
            );
          })}
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted w-20 shrink-0 font-mono">playwright</span>
            <div className="flex-1 h-5 bg-surface rounded overflow-hidden">
              <div
                className="h-full bg-muted/30 rounded flex items-center justify-end pr-2"
                style={{
                  width: `${Math.max((driftData.baseline.defTokens / maxDefTokens) * 100, 1)}%`,
                  minWidth: "fit-content",
                }}
              >
                <span className="text-[10px] font-mono text-foreground whitespace-nowrap">
                  {formatTokens(driftData.baseline.defTokens)}
                </span>
              </div>
            </div>
            <span className="text-xs text-muted w-16 shrink-0 text-right">
              {driftData.baseline.toolCount} tools
            </span>
          </div>
        </div>
      </div>

      {/* Footnotes */}
      <p className="mt-6 text-xs text-muted leading-relaxed max-w-2xl">
        Run date {driftData.meta.runDate}. Tokens &asymp; chars/4. Measured same-day against live
        pages &mdash; all versions are re-measured together each release, and rows from different
        run dates are never mixed. npm-installed historical versions float to whatever
        Puppeteer/Chromium build was current on the run date, per their loose semver ranges;
        per-row browser builds are recorded in the published{" "}
        <a
          href="https://github.com/TickTockBent/charlotte/tree/main/benchmarks/results/drift/2026-08-09"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:text-accent/80 transition-colors"
        >
          drift.json
        </a>
        .
      </p>
    </section>
  );
}
