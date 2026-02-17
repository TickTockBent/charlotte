const toolCategories = [
  {
    name: "Navigation",
    icon: "compass",
    tools: ["navigate", "back", "forward", "reload"],
    description:
      "Browse the web. Go to URLs, traverse history, refresh pages.",
  },
  {
    name: "Observation",
    icon: "eye",
    tools: ["observe", "find", "screenshot", "diff"],
    description:
      "Understand pages. Three detail levels, spatial search, visual capture, structural diffing.",
  },
  {
    name: "Interaction",
    icon: "pointer",
    tools: [
      "click",
      "type",
      "select",
      "toggle",
      "submit",
      "scroll",
      "hover",
      "key",
      "wait_for",
    ],
    description:
      "Act on pages. Click, type, submit forms, scroll, and poll for async conditions.",
  },
  {
    name: "Session",
    icon: "layers",
    tools: [
      "tabs",
      "tab_open",
      "tab_switch",
      "tab_close",
      "viewport",
      "network",
      "set_cookies",
      "set_headers",
      "configure",
    ],
    description:
      "Manage browser state. Tabs, viewports, network throttling, cookies, headers.",
  },
  {
    name: "Dev Mode",
    icon: "code",
    tools: ["dev_serve", "dev_inject", "dev_audit"],
    description:
      "Local development. Static server with hot reload, CSS/JS injection, accessibility audits.",
  },
  {
    name: "Utility",
    icon: "terminal",
    tools: ["evaluate"],
    description:
      "Execute arbitrary JavaScript in page context. Read computed values, trigger events.",
  },
];

function CategoryIcon({ icon }: { icon: string }) {
  const iconPaths: Record<string, React.ReactNode> = {
    compass: (
      <>
        <circle cx="12" cy="12" r="10" />
        <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
      </>
    ),
    eye: (
      <>
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    pointer: (
      <path d="M22 14a8 8 0 0 1-8 8h-1a8 8 0 0 1-6.3-3.1L2 12l4.7-1.6a4 4 0 0 1 4.6 1L13 13V4a2 2 0 1 1 4 0v6h1a4 4 0 0 1 4 4z" />
    ),
    layers: (
      <>
        <polygon points="12 2 2 7 12 12 22 7 12 2" />
        <polyline points="2 17 12 22 22 17" />
        <polyline points="2 12 12 17 22 12" />
      </>
    ),
    code: (
      <>
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </>
    ),
    terminal: (
      <>
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </>
    ),
  };

  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-accent"
      aria-hidden="true"
    >
      {iconPaths[icon]}
    </svg>
  );
}

export default function ToolGrid() {
  return (
    <section
      id="tools"
      className="py-20 px-6 sm:px-8 lg:px-12 border-t border-surface-border"
    >
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl font-bold tracking-tight mb-4">
          30 Tools, 6 Categories
        </h2>
        <p className="text-muted text-lg mb-10 max-w-2xl">
          Everything an agent needs to navigate, understand, and interact with
          the web.
        </p>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {toolCategories.map((category) => (
            <div
              key={category.name}
              className="rounded-lg border border-surface-border bg-surface p-5 hover:border-accent/30 transition-colors"
            >
              <div className="flex items-center gap-2.5 mb-3">
                <CategoryIcon icon={category.icon} />
                <h3 className="font-semibold text-foreground">
                  {category.name}
                </h3>
                <span className="ml-auto text-xs font-mono text-muted">
                  {category.tools.length}
                </span>
              </div>
              <p className="text-sm text-muted mb-4 leading-relaxed">
                {category.description}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {category.tools.map((tool) => (
                  <code
                    key={tool}
                    className="text-xs font-mono px-2 py-0.5 rounded bg-background text-foreground/70 border border-surface-border"
                  >
                    {tool}
                  </code>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
