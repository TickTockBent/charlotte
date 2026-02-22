"use client";

import { useState } from "react";
import CodeBlock from "./CodeBlock";

const minimalRepresentation = `{
  "url": "https://news.ycombinator.com",
  "title": "Hacker News",
  "viewport": { "width": 1280, "height": 720 },
  "structure": {
    "headings": [
      { "level": 1, "text": "Hacker News", "id": "h-a1b2" }
    ]
  },
  "interactive_summary": {
    "total": 93,
    "by_landmark": {
      "(page root)": { "link": 91, "text_input": 1, "button": 1 }
    }
  }
}`;

const summaryRepresentation = `{
  "url": "https://example.com/dashboard",
  "title": "Dashboard",
  "viewport": { "width": 1280, "height": 720 },
  "structure": {
    "landmarks": [
      { "role": "banner", "label": "Site header",
        "bounds": { "x": 0, "y": 0, "w": 1280, "h": 64 } },
      { "role": "main", "label": "Content",
        "bounds": { "x": 240, "y": 64, "w": 1040, "h": 656 } }
    ],
    "headings": [
      { "level": 1, "text": "Dashboard", "id": "h-1a2b" }
    ],
    "content_summary": "main: 2 headings, 5 links, 1 form"
  },
  "interactive": [
    {
      "id": "btn-a3f1",
      "type": "button",
      "label": "Create Project",
      "bounds": { "x": 960, "y": 80, "w": 160, "h": 40 },
      "state": {}
    }
  ]
}`;

type DetailTab = "minimal" | "summary";

const detailLevels = [
  {
    name: "minimal",
    tokens: "~50-200",
    description: "Landmarks, headings, interactive counts by region",
  },
  {
    name: "summary",
    tokens: "~500-5000",
    description: "Full element list, forms, content summaries",
  },
  {
    name: "full",
    tokens: "variable",
    description: "Everything in summary, plus all visible text",
  },
];

const elementIdExamples = [
  { id: "btn-a3f1", type: "button" },
  { id: "inp-c7e2", type: "text input" },
  { id: "lnk-d4b9", type: "link" },
  { id: "sel-e8a3", type: "select" },
  { id: "chk-f1a2", type: "checkbox" },
  { id: "frm-b1d4", type: "form" },
];

export default function OutputDemo() {
  const [activeDetail, setActiveDetail] = useState<DetailTab>("minimal");

  return (
    <section id="output" className="py-20 px-6 sm:px-8 lg:px-12">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl font-bold tracking-tight mb-4">
          What Charlotte Returns
        </h2>
        <p className="text-muted text-lg mb-10 max-w-2xl">
          Agents control how much context they receive. Navigate returns a compact
          orientation; observe returns the full element list when needed.
        </p>

        <div className="grid lg:grid-cols-5 gap-8">
          {/* JSON output with detail toggle */}
          <div className="lg:col-span-3 min-w-0">
            {/* Detail toggle */}
            <div className="flex gap-1 p-1 rounded-lg bg-surface border border-surface-border mb-4 w-fit">
              <button
                onClick={() => setActiveDetail("minimal")}
                className={`px-3 py-1.5 rounded-md text-xs font-mono font-medium transition-colors ${
                  activeDetail === "minimal"
                    ? "bg-accent/10 text-accent"
                    : "text-muted hover:text-foreground"
                }`}
              >
                minimal
                <span className="ml-1.5 text-muted">336 chars</span>
              </button>
              <button
                onClick={() => setActiveDetail("summary")}
                className={`px-3 py-1.5 rounded-md text-xs font-mono font-medium transition-colors ${
                  activeDetail === "summary"
                    ? "bg-accent/10 text-accent"
                    : "text-muted hover:text-foreground"
                }`}
              >
                summary
                <span className="ml-1.5 text-muted">full list</span>
              </button>
            </div>
            <CodeBlock
              code={activeDetail === "minimal" ? minimalRepresentation : summaryRepresentation}
              language="PageRepresentation"
            />
          </div>

          {/* Sidebar: detail levels + element IDs */}
          <div className="lg:col-span-2 min-w-0 space-y-8">
            {/* Detail levels */}
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted mb-4">
                Detail Levels
              </h3>
              <div className="space-y-3">
                {detailLevels.map((level) => (
                  <div
                    key={level.name}
                    className="flex items-start gap-3 p-3 rounded-lg border border-surface-border bg-surface"
                  >
                    <code className="font-mono text-sm text-accent whitespace-nowrap">
                      {level.name}
                    </code>
                    <div className="text-sm">
                      <span className="text-muted">{level.tokens}</span>
                      <span className="text-muted"> — </span>
                      <span className="text-foreground/80">{level.description}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Element IDs */}
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted mb-4">
                Stable Element IDs
              </h3>
              <p className="text-sm text-muted mb-3">
                Hash-based IDs survive DOM mutations and element reordering.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {elementIdExamples.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 px-3 py-2 rounded border border-surface-border bg-surface"
                  >
                    <code className="font-mono text-sm text-accent">{item.id}</code>
                    <span className="text-xs text-muted">{item.type}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
