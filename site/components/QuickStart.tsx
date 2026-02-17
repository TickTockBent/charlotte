import CodeBlock from "./CodeBlock";

const installCode = `git clone https://github.com/TickTockBent/charlotte.git
cd charlotte
npm install
npm run build`;

const claudeCodeConfig = `{
  "mcpServers": {
    "charlotte": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/charlotte/dist/index.js"],
      "env": {}
    }
  }
}`;

const claudeDesktopConfig = `{
  "mcpServers": {
    "charlotte": {
      "command": "node",
      "args": ["/path/to/charlotte/dist/index.js"]
    }
  }
}`;

export default function QuickStart() {
  return (
    <section
      id="quickstart"
      className="py-20 px-6 sm:px-8 lg:px-12 border-t border-surface-border"
    >
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl font-bold tracking-tight mb-4">Quick Start</h2>
        <p className="text-muted text-lg mb-10 max-w-2xl">
          Get Charlotte running in under a minute. Requires Node.js &gt;= 22
          and npm.
        </p>

        <div className="space-y-10">
          {/* Install */}
          <div>
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-accent/10 text-accent text-sm font-mono font-bold">
                1
              </span>
              Install &amp; Build
            </h3>
            <CodeBlock code={installCode} language="bash" />
          </div>

          {/* Configure */}
          <div>
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-accent/10 text-accent text-sm font-mono font-bold">
                2
              </span>
              Configure Your MCP Client
            </h3>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="min-w-0">
                <p className="text-sm text-muted mb-3">
                  <strong className="text-foreground">Claude Code</strong> —
                  create{" "}
                  <code className="font-mono text-accent text-xs">.mcp.json</code>{" "}
                  in your project root:
                </p>
                <CodeBlock code={claudeCodeConfig} language=".mcp.json" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-muted mb-3">
                  <strong className="text-foreground">Claude Desktop</strong> —
                  add to{" "}
                  <code className="font-mono text-accent text-xs">
                    claude_desktop_config.json
                  </code>
                  :
                </p>
                <CodeBlock
                  code={claudeDesktopConfig}
                  language="claude_desktop_config.json"
                />
              </div>
            </div>
          </div>

          {/* Verify */}
          <div>
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-accent/10 text-accent text-sm font-mono font-bold">
                3
              </span>
              Verify It Works
            </h3>
            <CodeBlock
              code={`navigate({ url: "https://example.com" })
// Returns: title "Example Domain", landmarks, headings, 1 link

observe({ detail: "minimal" })
// Returns: landmarks + interactive elements only`}
              language="verification"
            />
          </div>

          {/* Links */}
          <div className="flex flex-wrap gap-4 pt-2">
            <a
              href="https://github.com/TickTockBent/charlotte/blob/main/docs/mcp-setup.md"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-accent hover:text-accent/80 transition-colors"
            >
              Full setup guide &rarr;
            </a>
            <a
              href="https://github.com/TickTockBent/charlotte/blob/main/docs/sandbox.md"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-accent hover:text-accent/80 transition-colors"
            >
              Sandbox test site &rarr;
            </a>
            <a
              href="https://github.com/TickTockBent/charlotte/blob/main/docs/CHARLOTTE_SPEC.md"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-accent hover:text-accent/80 transition-colors"
            >
              Full specification &rarr;
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
