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
      "drag",
      "key",
      "wait_for",
    ],
    description:
      "Act on pages. Click, type, submit forms, drag elements, scroll, and poll for async conditions.",
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
    tools: ["evaluate", "dialog"],
    description:
      "Execute arbitrary JavaScript in page context. Handle browser dialogs (alert, confirm, prompt).",
  },
  {
    name: "Monitoring",
    icon: "activity",
    tools: ["console", "requests"],
    description:
      "Inspect runtime behavior. Retrieve console messages and network request history with filters.",
  },
  {
    name: "Meta",
    icon: "settings",
    tools: ["tools"],
    description:
      "Manage tool visibility at runtime. List, enable, and disable tool groups without restarting.",
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
    activity: (
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
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
          40 Tools, 8 Categories
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
