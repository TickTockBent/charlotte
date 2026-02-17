import CopyButton from "./CopyButton";

function ArchitectureDiagram() {
  const boxStroke = "var(--surface-border)";
  const accentStroke = "var(--accent)";
  const textColor = "var(--muted)";
  const labelColor = "var(--foreground)";

  return (
    <svg
      width="380"
      height="240"
      viewBox="0 0 380 240"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Architecture diagram: AI Agent communicates with Charlotte via MCP Protocol. Charlotte contains a Renderer Pipeline which drives Headless Chromium."
      role="img"
    >
      {/* AI Agent box */}
      <rect x="10" y="40" width="110" height="44" rx="4" stroke={boxStroke} strokeWidth="1.5" />
      <text x="65" y="66" textAnchor="middle" fill={labelColor} fontSize="13" fontFamily="var(--font-geist-mono), monospace">AI Agent</text>

      {/* MCP Protocol arrow */}
      <line x1="120" y1="62" x2="220" y2="62" stroke={accentStroke} strokeWidth="1.5" />
      <polygon points="218,57 228,62 218,67" fill={accentStroke} />
      <polygon points="122,57 112,62 122,67" fill={accentStroke} />
      <text x="170" y="50" textAnchor="middle" fill={textColor} fontSize="11" fontFamily="var(--font-geist-mono), monospace">MCP Protocol</text>

      {/* Charlotte outer box */}
      <rect x="220" y="10" width="150" height="220" rx="4" stroke={boxStroke} strokeWidth="1.5" />
      <text x="295" y="38" textAnchor="middle" fill={labelColor} fontSize="13" fontFamily="var(--font-geist-mono), monospace">Charlotte</text>

      {/* Renderer Pipeline box */}
      <rect x="235" y="56" width="120" height="44" rx="4" stroke={accentStroke} strokeWidth="1" strokeDasharray="4 2" />
      <text x="295" y="74" textAnchor="middle" fill={textColor} fontSize="11" fontFamily="var(--font-geist-mono), monospace">Renderer</text>
      <text x="295" y="89" textAnchor="middle" fill={textColor} fontSize="11" fontFamily="var(--font-geist-mono), monospace">Pipeline</text>

      {/* Arrow down */}
      <line x1="295" y1="100" x2="295" y2="130" stroke={accentStroke} strokeWidth="1.5" />
      <polygon points="290,128 295,138 300,128" fill={accentStroke} />

      {/* Headless Chromium box */}
      <rect x="235" y="140" width="120" height="44" rx="4" stroke={accentStroke} strokeWidth="1" strokeDasharray="4 2" />
      <text x="295" y="158" textAnchor="middle" fill={textColor} fontSize="11" fontFamily="var(--font-geist-mono), monospace">Headless</text>
      <text x="295" y="173" textAnchor="middle" fill={textColor} fontSize="11" fontFamily="var(--font-geist-mono), monospace">Chromium</text>
    </svg>
  );
}

export default function Hero() {
  return (
    <section className="relative pt-24 pb-20 px-6 sm:px-8 lg:px-12">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-12">
          {/* Left: Text content */}
          <div className="flex-1 max-w-xl">
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-6">
              The Web,{" "}
              <span className="text-accent">Readable.</span>
            </h1>
            <p className="text-lg text-muted leading-relaxed mb-8">
              Charlotte is an MCP server that renders web pages into structured,
              agent-readable representations using headless Chromium. Navigation,
              observation, and interaction — without vision models or brittle
              selectors.
            </p>

            {/* Install command */}
            <div className="flex items-center gap-3 mb-6">
              <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-surface border border-surface-border font-mono text-sm flex-1 max-w-sm">
                <span className="text-muted select-none">$</span>
                <span className="text-foreground">npm install charlotte-web</span>
                <span className="ml-auto">
                  <CopyButton text="npm install charlotte-web" />
                </span>
              </div>
            </div>

            {/* CTAs */}
            <div className="flex flex-wrap gap-3">
              <a
                href="https://github.com/TickTockBent/charlotte"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-foreground text-background font-medium text-sm hover:bg-foreground/90 transition-colors"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
                GitHub
              </a>
              <a
                href="https://www.npmjs.com/package/charlotte-web"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-surface-border font-medium text-sm hover:bg-surface-hover transition-colors"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M0 7.334v8h6.666v1.332H12v-1.332h12v-8H0zm6.666 6.664H5.334v-4H3.999v4H1.335V8.667h5.331v5.331zm4 0h-2.666V8.667h2.666v5.331zm12 0h-1.332v-4h-1.338v4h-1.33v-4h-1.336v4H16v-5.331h6.666v5.331zM11.333 8.667h1.333v4h-1.333V8.667z" />
                </svg>
                npm
              </a>
            </div>
          </div>

          {/* Right: Architecture diagram */}
          <div className="hidden lg:block flex-shrink-0">
            <div className="rounded-lg border border-surface-border bg-surface p-6">
              <ArchitectureDiagram />
            </div>
          </div>
        </div>

        {/* Stats bar */}
        <div className="mt-16 flex flex-wrap gap-8 sm:gap-12 text-sm">
          <div>
            <span className="font-mono text-2xl font-bold text-accent">30</span>
            <span className="ml-2 text-muted">MCP tools</span>
          </div>
          <div>
            <span className="font-mono text-2xl font-bold text-accent">6</span>
            <span className="ml-2 text-muted">categories</span>
          </div>
          <div>
            <span className="font-mono text-2xl font-bold text-accent">222</span>
            <span className="ml-2 text-muted">tests passing</span>
          </div>
          <div>
            <span className="font-mono text-lg font-bold text-foreground">MIT</span>
            <span className="ml-2 text-muted">license</span>
          </div>
        </div>
      </div>
    </section>
  );
}
