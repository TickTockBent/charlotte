import CodeBlock from "./CodeBlock";
import CopyButton from "./CopyButton";

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

const dockerRemoteCommand =
  "docker run --cap-add SYS_ADMIN --shm-size 2g -p 3737:3737 ghcr.io/ticktockbent/charlotte";

interface QuickStartProps {
  /** "full" renders the complete section (landing page). "compact" renders
   * just the two-path content for embedding inside a page's own heading
   * (vs-playwright). */
  variant?: "full" | "compact";
}

function RemoteSelfHost({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "" : undefined}>
      {compact ? (
        <div className="rounded-lg border border-surface-border bg-surface p-5 font-mono text-sm max-w-xl">
          <div className="text-muted mb-1"># Self-host Charlotte Remote</div>
          <div className="flex items-start justify-between gap-3">
            <div className="text-foreground break-all">{dockerRemoteCommand}</div>
            <span className="shrink-0 mt-0.5">
              <CopyButton text={dockerRemoteCommand} />
            </span>
          </div>
        </div>
      ) : (
        <CodeBlock code={dockerRemoteCommand} language="bash" />
      )}
      <p className={`text-sm text-muted ${compact ? "mt-3" : "mt-4"} max-w-xl`}>
        Stands up a public tunnel URL and an operator token, and prints the
        connector strings for claude.ai &mdash; paste the URL into{" "}
        <strong className="text-foreground">
          Settings &rarr; Connectors &rarr; Add custom connector
        </strong>
        , leave OAuth Client ID/Secret blank, and enter the token when
        prompted.
      </p>
      <div className="flex flex-wrap gap-4 pt-3 text-sm">
        <a
          href="https://github.com/TickTockBent/charlotte/blob/main/SELF_HOSTING.md"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:text-accent/80 transition-colors"
        >
          Self-hosting guide &rarr;
        </a>
        <a
          href="https://github.com/TickTockBent/charlotte/blob/main/SECURITY.md"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:text-accent/80 transition-colors"
        >
          Trust model &amp; network guards &rarr;
        </a>
      </div>
    </div>
  );
}

function QuickStartContent({ compact }: { compact: boolean }) {
  if (compact) {
    return (
      <div className="grid sm:grid-cols-2 gap-8">
        <div className="min-w-0">
          <h3 className="text-base font-semibold mb-3">
            Claude Code / any stdio MCP client
          </h3>
          <div className="rounded-lg border border-surface-border bg-surface p-5 font-mono text-sm">
            <div className="text-muted mb-1"># Install</div>
            <div className="text-foreground">
              npx @ticktockbent/charlotte@latest
            </div>
          </div>
          <p className="text-sm text-muted mt-3 max-w-xl">
            Add it to <code className="font-mono text-accent text-xs">.mcp.json</code> or{" "}
            <code className="font-mono text-accent text-xs">claude_desktop_config.json</code>{" "}
            and it runs over stdio &mdash; no separate server to manage.
          </p>
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-semibold mb-3">
            Self-host Charlotte Remote for claude.ai
          </h3>
          <RemoteSelfHost compact />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {/* Configure (stdio) */}
      <div>
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-accent/10 text-accent text-sm font-mono font-bold">
            1
          </span>
          Use It From Claude Code / Any Stdio MCP Client
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

      {/* Self-host Charlotte Remote */}
      <div>
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-accent/10 text-accent text-sm font-mono font-bold">
            2
          </span>
          Self-Host Charlotte Remote for claude.ai
        </h3>
        <p className="text-sm text-muted mb-3 max-w-2xl">
          One command stands up Charlotte as a network-reachable MCP server
          you connect from claude.ai instead of a local client:
        </p>
        <RemoteSelfHost />
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
          href="https://github.com/TickTockBent/charlotte/blob/main/SELF_HOSTING.md"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-accent hover:text-accent/80 transition-colors"
        >
          Self-hosting guide &rarr;
        </a>
        <a
          href="https://github.com/TickTockBent/charlotte/blob/main/SECURITY.md"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-accent hover:text-accent/80 transition-colors"
        >
          Trust model &amp; network guards &rarr;
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
  );
}

export default function QuickStart({ variant = "full" }: QuickStartProps) {
  if (variant === "compact") {
    return <QuickStartContent compact />;
  }

  return (
    <section
      id="quickstart"
      className="py-20 px-6 sm:px-8 lg:px-12 border-t border-surface-border"
      data-asm-role="interactive"
      data-asm-summary="Installation and setup instructions for Charlotte: use it from Claude Code or any stdio MCP client via npx, or self-host Charlotte Remote with one Docker command to connect from claude.ai."
      data-asm-priority="critical"
    >
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl font-bold tracking-tight mb-4">Quick Start</h2>
        <p className="text-muted text-lg mb-10 max-w-2xl">
          Get Charlotte running in under a minute. No install required —{" "}
          <code className="font-mono text-accent text-xs">npx</code> handles
          everything for local MCP clients. Want to connect from claude.ai
          instead? Self-host Charlotte Remote with a single Docker command.
        </p>

        <QuickStartContent compact={false} />
      </div>
    </section>
  );
}
