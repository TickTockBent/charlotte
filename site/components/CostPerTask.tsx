// Canonical source for this data lives in benchmarks/results/ at the repo root
// (outside site/, which is the Vercel project root and the only tree that
// triggers a deploy). The release ritual: re-run the benchmarks, commit the
// results under benchmarks/results/, then copy the new dated JSON files into
// site/data/ and update the import below — that's what makes the site deploy
// pick up the new numbers.
import tasksData from "@/data/tasks-2026-08-09.json";

const TASK_LABELS: Record<string, string> = {
  T1: "orient-and-read",
  T2: "find-and-act",
  T3: "form-fill",
};

function formatTokens(value: number): string {
  return value.toLocaleString("en-US");
}

function formatMultiplier(factor: number): string {
  if (factor < 5) {
    const rounded = factor.toFixed(1);
    return rounded.endsWith(".0") ? rounded.slice(0, -2) : rounded;
  }
  return Math.round(factor).toString();
}

export default function CostPerTask() {
  const rows = tasksData.tasks.map((task) => {
    const charlotteTokens = task.charlotte.run1.totalTokens;
    const charlotteCalls = task.charlotte.run1.callCount;
    const playwrightTokens = task.playwright.run1.totalTokens;
    const playwrightCalls = task.playwright.run1.callCount;
    const charlotteCheaper = playwrightTokens >= charlotteTokens;
    const factor = charlotteCheaper
      ? playwrightTokens / charlotteTokens
      : charlotteTokens / playwrightTokens;
    return {
      taskId: task.taskId,
      name: TASK_LABELS[task.taskId] ?? task.name,
      charlotteTokens,
      charlotteCalls,
      playwrightTokens,
      playwrightCalls,
      charlotteCheaper,
      factorLabel: `${formatMultiplier(factor)}× ${charlotteCheaper ? "cheaper" : "more expensive"}`,
      isFormFill: task.taskId === "T3",
    };
  });

  return (
    <section className="mb-16" aria-labelledby="cost-per-task-heading">
      <h2 id="cost-per-task-heading" className="text-2xl font-bold tracking-tight mb-4">
        Cost per task
      </h2>
      <p className="text-sm text-foreground/90 mb-4 max-w-2xl leading-relaxed">
        A single navigate call is a convenient number, but it isn&apos;t what an agent actually
        pays for real work. Per-task totals &mdash; every call in a realistic sequence, summed
        &mdash; are the more honest measure. Each server got its own most efficient reasonable
        call path for each task; nobody was handicapped. The exact sequences and full methodology
        are published in the repo&apos;s{" "}
        <a
          href="https://github.com/TickTockBent/charlotte/tree/main/benchmarks/results/tasks/2026-08-09"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:text-accent/80 transition-colors"
        >
          benchmarks/results/tasks/2026-08-09
        </a>
        .
      </p>
      <p className="text-xs text-muted mb-8 max-w-2xl">
        Tool-definition cost (one-time per session, not per task) is excluded from these totals
        &mdash; see{" "}
        <a href="#release-drift-heading" className="text-accent hover:text-accent/80 transition-colors">
          Release drift
        </a>{" "}
        above.
      </p>

      <div className="rounded-lg border border-surface-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border bg-surface">
                <th className="text-left py-3 px-4 text-muted font-medium">Task</th>
                <th className="text-right py-3 px-4 text-accent font-medium">
                  Charlotte {tasksData.meta.servers.charlotte.version}
                </th>
                <th className="text-right py-3 px-4 text-muted font-medium">
                  Playwright {tasksData.meta.servers.playwright.version}
                </th>
                <th className="text-right py-3 px-4 text-muted font-medium">Ratio</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.taskId} className="border-b border-surface-border last:border-0">
                  <td className="py-3 px-4 text-foreground">
                    {row.name}
                    {row.isFormFill && (
                      <sup className="ml-0.5 text-muted" aria-hidden="true">
                        †
                      </sup>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-foreground">
                    {formatTokens(row.charlotteTokens)} tok / {row.charlotteCalls} calls
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-muted">
                    {formatTokens(row.playwrightTokens)} tok / {row.playwrightCalls} calls
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-foreground">
                    {row.factorLabel}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 bg-surface text-xs text-muted leading-relaxed">
          <sup aria-hidden="true">†</sup> Charlotte currently returns the full page
          representation after every mutating call. Measured on this same-page form-fill
          sequence, that&apos;s ~96% redundant &mdash; most of each response repeats content the
          action didn&apos;t touch. v0.9&apos;s delta-first responses target exactly this.
        </div>
      </div>
    </section>
  );
}
