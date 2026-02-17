"use client";

import { useState } from "react";
import CodeBlock from "./CodeBlock";

const examples = [
  {
    tab: "Browse",
    label: "Browse a website",
    code: `// Navigate to a page
navigate({ url: "https://example.com" })

// See what's on the page
observe({ detail: "summary" })

// Find a specific element
find({ type: "link", text: "About" })

// Click it
click({ element_id: "lnk-a3f1" })`,
  },
  {
    tab: "Forms",
    label: "Fill out a form",
    code: `// See the form structure
observe({ detail: "minimal" })

// Fill in fields
type({ element_id: "inp-c7e2", text: "hello@example.com" })
select({ element_id: "sel-e8a3", value: "option-2" })
toggle({ element_id: "chk-f1a2" })

// Submit
submit({ form_id: "frm-b1d4" })`,
  },
  {
    tab: "Dev Mode",
    label: "Local development feedback loop",
    code: `// Serve your site locally with hot reload
dev_serve({ path: "./my-site", watch: true })

// Inspect the rendered page
observe({ detail: "full" })

// Run accessibility + contrast audit
dev_audit({ checks: ["a11y", "contrast"] })

// Inject experimental styles
dev_inject({ css: "body { font-size: 18px; }" })

// Check mobile layout
viewport({ device: "mobile" })
observe({ detail: "summary" })`,
  },
];

export default function UsageExamples() {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <section
      id="examples"
      className="py-20 px-6 sm:px-8 lg:px-12 border-t border-surface-border"
    >
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl font-bold tracking-tight mb-4">
          Usage Examples
        </h2>
        <p className="text-muted text-lg mb-10 max-w-2xl">
          Once connected as an MCP server, agents can use Charlotte&apos;s tools
          directly.
        </p>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-surface-border">
          {examples.map((example, index) => (
            <button
              key={example.tab}
              onClick={() => setActiveTab(index)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === index
                  ? "border-accent text-accent"
                  : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {example.tab}
            </button>
          ))}
        </div>

        {/* Active example */}
        <div>
          <p className="text-sm text-muted mb-4">{examples[activeTab].label}</p>
          <CodeBlock code={examples[activeTab].code} language="tool calls" />
        </div>
      </div>
    </section>
  );
}
