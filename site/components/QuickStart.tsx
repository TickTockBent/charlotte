import CodeBlock from "./CodeBlock";

const claudeCodeConfig = `{
  "mcpServers": {
    "charlotte": {
      "type": "stdio",
      "command": "npx",
      "args": ["@ticktockbent/charlotte"],
      "env": {}
    }
  }
}`;

const claudeDesktopConfig = `{
  "mcpServers": {
    "charlotte": {
      "command": "npx",
      "args": ["@ticktockbent/charlotte"]
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
          Get Charlotte running in under a minute. No install required —{" "}
          <code className="font-mono text-accent text-xs">npx</code> handles
          everything. Just add the config and go.
        </p>

        <div className="space-y-10">
          {/* Configure */}
          <div>
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-accent/10 text-accent text-sm font-mono font-bold">
                1
              </span>
              Add to Your MCP Client
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
                2
              </span>
              Verify It Works
            </h3>
            <CodeBlock
              code={`navigate({ url: "https://example.com" })
// Returns: 612 chars — title, landmarks, headings, interactive counts

find({ type: "link" })
// Returns: matching elements with IDs ready for interaction`}
              language="verification"
            />
          </div>

          {/* Optional global install */}
          <div className="p-4 rounded-lg border border-surface-border bg-surface">
            <p className="text-sm text-muted">
              <strong className="text-foreground">Optional:</strong> For faster
              startup (skips npx resolution), install globally:
            </p>
            <code className="block mt-2 font-mono text-sm text-accent">
              npm install -g @ticktockbent/charlotte
            </code>
            <p className="text-xs text-muted mt-2">
              Then replace{" "}
              <code className="font-mono text-accent">{`"command": "npx"`}</code>{" "}
              with{" "}
              <code className="font-mono text-accent">{`"command": "charlotte"`}</code>{" "}
              in your config.
            </p>
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
