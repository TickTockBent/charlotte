# Charlotte: Tiered Tool Visibility Analysis

## The Problem

Charlotte registers **39 tools** across 8 modules. Every one of these tools — name, description, input schema with parameter descriptions — gets serialized into the `tools/list` response and injected into the agent's context window before the first message. Conservative estimate: **5,000–9,000 tokens** of tool definitions before the agent even says hello.

Most sessions don't need most tools. A browsing agent doesn't need `dev_serve` or `dev_audit`. An audit agent doesn't need `drag` or `hover`. A quick page inspection doesn't need cookie management, network throttling, or tab orchestration. But right now, every agent pays the full token tax regardless.

**Current tool breakdown by module:**

| Module | Tools | What it covers |
|--------|-------|----------------|
| Navigation | 4 | navigate, back, forward, reload |
| Observation | 7 | observe, find, screenshot (×4), diff |
| Interaction | 10 | click, type, select, toggle, submit, scroll, hover, drag, key, wait_for |
| Session | 11 | cookies (×3), headers, configure, tabs (×4), viewport, network |
| Dev Mode | 3 | dev_serve, dev_inject, dev_audit |
| Dialog | 1 | dialog |
| Evaluate | 1 | evaluate |
| Monitoring | 2 | console, requests |

Session (11) and Interaction (10) alone account for over half the tools, and many sessions never touch cookies, network throttling, or drag-and-drop.

---

## Good News: The MCP SDK Already Supports This

The `@modelcontextprotocol/sdk` v1.12 that Charlotte already depends on has built-in support for dynamic tool visibility. Every tool returned by `registerTool()` gets an object with these methods:

```typescript
const tool = server.registerTool("charlotte:drag", { ... }, handler);

tool.disable();  // Hides from tools/list, sends list_changed notification
tool.enable();   // Shows again, sends list_changed notification  
tool.remove();   // Fully removes the tool
tool.update({ description, enabled, ... });  // Modify anything
```

When any of these are called, the SDK automatically:
1. Updates the internal `_registeredTools` registry
2. Filters `tools/list` responses to only include `enabled: true` tools
3. Sends a `notifications/tools/list_changed` notification to the client

Claude Code already handles `list_changed` notifications — it refreshes its tool list without reconnecting. Claude Code also has its own "Tool Search" feature that kicks in when MCP tool descriptions exceed 10% of context, but that's a client-side mitigation, not a server-side solution.

**The catch:** Not all MCP clients support `list_changed` notifications yet. Claude Desktop, some community clients, and older integrations may not re-query `tools/list` after a notification. So any solution needs a fallback.

---

## Proposed Approaches

### Approach 1: Startup Profiles (CLI flags)

The simplest, most client-compatible approach. Charlotte accepts a `--profile` or `--tools` flag that determines which tool groups are registered at startup.

**Profiles (predefined sets):**

| Profile | Tools loaded | Use case |
|---------|-------------|----------|
| `core` | navigate, observe, find, click, type, submit | Minimal browsing — 6 tools |
| `browse` | core + back, forward, scroll, select, toggle, screenshot, tabs | General web interaction — 14 tools |
| `interact` | browse + hover, drag, key, wait_for, dialog, evaluate | Full interaction — 20 tools |
| `develop` | interact + dev_serve, dev_inject, dev_audit, diff | Local dev workflow — 24 tools |
| `audit` | core + dev_audit, diff, screenshot, viewport | Audit scanning — 11 tools |
| `full` | Everything | All 39 tools (current behavior) |

**Granular flag (pick groups):**
```
charlotte --tools navigation,observation,interaction
```

**Implementation sketch:**

```typescript
// index.ts
const args = process.argv.slice(2);
const profileArg = args.find(a => a.startsWith('--profile='))?.split('=')[1] ?? 'full';

const server = createServer({
  ...deps,
  profile: profileArg as ToolProfile,
});
```

```typescript
// server.ts
export function createServer(deps: ServerDeps & { profile: ToolProfile }): McpServer {
  const server = new McpServer({ name: "charlotte", version: "0.3.0" }, ...);
  
  const groups = resolveProfile(deps.profile);
  // groups = Set<'navigation' | 'observation' | 'interaction' | ...>
  
  if (groups.has('navigation'))  registerNavigationTools(server, toolDeps);
  if (groups.has('observation')) registerObservationTools(server, toolDeps);
  if (groups.has('interaction')) registerInteractionTools(server, toolDeps);
  // ...
}
```

**MCP client config example:**
```json
{
  "mcpServers": {
    "charlotte": {
      "command": "node",
      "args": ["/path/to/charlotte/dist/index.js", "--profile=browse"]
    }
  }
}
```

**Pros:** Works with every MCP client. Zero runtime complexity. Agent gets exactly the tools it needs, no more.

**Cons:** Static — can't adapt mid-session. User must choose up front.

---

### Approach 2: Runtime Tool Groups via Meta-Tool

Add a `charlotte:tools` meta-tool that lets the agent discover and enable/disable tool groups at runtime. This is always registered regardless of profile.

**The meta-tool:**

```typescript
server.registerTool("charlotte:tools", {
  description: "Manage Charlotte tool visibility. Call with no args to list available " +
    "tool groups and their status. Use 'enable' or 'disable' to control which tools " +
    "are loaded. Disabled tools don't appear in the tool list — enable a group to " +
    "access its tools.",
  inputSchema: {
    action: z.enum(["list", "enable", "disable"]).optional()
      .describe('"list" (default), "enable", or "disable"'),
    group: z.enum([
      "navigation", "observation", "interaction", "session",
      "dev_mode", "dialog", "evaluate", "monitoring"
    ]).optional()
      .describe("Tool group to enable or disable"),
  },
}, async ({ action, group }) => {
  if (action === "enable" && group) {
    toolGroups[group].forEach(t => t.enable());
    return { content: [{ type: "text", text: `Enabled ${group} tools.` }] };
  }
  if (action === "disable" && group) {
    toolGroups[group].forEach(t => t.disable());
    return { content: [{ type: "text", text: `Disabled ${group} tools.` }] };
  }
  // Default: list all groups with status
  return { content: [{ type: "text", text: JSON.stringify(getGroupStatus()) }] };
});
```

**How it works in practice:**

1. Charlotte starts with only core tools + `charlotte:tools` enabled (~8 tools instead of 39)
2. Agent sees it needs to fill a form → calls `charlotte:tools({ action: "enable", group: "interaction" })`
3. SDK sends `list_changed`, client refreshes tool list
4. Agent now has interaction tools available
5. Agent finishes form work → optionally disables interaction group

**Storing tool references:**

```typescript
// In createServer, capture the returned tool objects
const registeredTools: Record<string, ReturnType<typeof server.registerTool>> = {};

// Modify each register function to return its tools
function registerNavigationTools(server, deps) {
  registeredTools['charlotte:navigate'] = server.registerTool("charlotte:navigate", ...);
  registeredTools['charlotte:back'] = server.registerTool("charlotte:back", ...);
  // ...
}

// Group mapping
const toolGroups = {
  navigation: ['charlotte:navigate', 'charlotte:back', 'charlotte:forward', 'charlotte:reload'],
  interaction: ['charlotte:click', 'charlotte:type', ...],
  // ...
};
```

**Pros:** Adaptive. Agent loads exactly what it needs, when it needs it. Combines well with Approach 1 (profiles set the starting state, meta-tool adjusts at runtime).

**Cons:** Requires client support for `list_changed`. Adds one tool call per group enable, which is its own small cost. Agents need to learn when to enable groups (though the `charlotte:tools` description guides this).

---

### Approach 3: Server Instructions (Supplementary)

The MCP spec supports an `instructions` field on the server that gets surfaced to the client. This can tell the agent about available tool groups without consuming tool-definition tokens.

```typescript
const server = new McpServer(
  { name: "charlotte", version: "0.3.0" },
  {
    capabilities: { tools: {} },
    instructions: `Charlotte browser automation server. Active profile: ${profile}.
      Additional tool groups available via charlotte:tools: 
      interaction (click, type, select, form controls), 
      session (cookies, tabs, viewport, network), 
      dev_mode (local server, injection, audits), 
      monitoring (console logs, network requests).
      Call charlotte:tools to enable groups as needed.`
  }
);
```

**Pros:** Gives the agent awareness of available capabilities without tool-definition overhead. Works as a complement to Approaches 1 and 2.

**Cons:** Not all clients surface `instructions`. The agent might ignore it. Supplementary only — doesn't reduce tool count on its own.

---

## Recommended Strategy: Profiles + Meta-Tool

Combine Approaches 1 and 2 for maximum compatibility and flexibility.

**Default behavior changes:**
- Default profile becomes `browse` instead of `full` (14 tools instead of 39)
- `charlotte:tools` meta-tool is always registered
- `--profile=full` restores current behavior for users who want everything

**For clients that support `list_changed` (Claude Code, etc.):**
The agent starts lean, discovers it needs more tools, calls `charlotte:tools` to enable them. Efficient and adaptive.

**For clients that don't support `list_changed`:**
The user picks the right profile in their MCP config. Tools are all available from the start within that profile. `charlotte:tools` still works for listing what's available, even if enable/disable won't take effect until reconnect.

**Token savings estimate:**

| Profile | Tools | Est. tokens | Savings vs full |
|---------|-------|-------------|-----------------|
| `full` (current) | 39 | ~7,000–9,000 | — |
| `browse` (new default) | 14 | ~2,500–3,500 | ~60% |
| `core` | 6 | ~1,200–1,800 | ~80% |
| `audit` | 11 | ~2,000–2,800 | ~70% |

---

## Implementation Checklist

1. **Define tool groups** — Create a `ToolGroup` type and group-to-tools mapping
2. **Define profiles** — Create a `ToolProfile` type and profile-to-groups mapping
3. **Add CLI arg parsing** — Parse `--profile=` and `--tools=` from `process.argv`
4. **Refactor registration functions** — Return tool references from each `register*Tools` function
5. **Add `charlotte:tools` meta-tool** — Implement the enable/disable/list handler
6. **Apply initial profile** — Disable non-profile tools after registration
7. **Update server instructions** — Include available groups in the MCP instructions field
8. **Update docs** — Document profiles in README, mcp-setup.md, and CHARLOTTE_SPEC.md
9. **Update MCP config examples** — Show `--profile` usage in setup docs

The refactoring is mostly mechanical — the SDK already does the hard work. The main design decision is choosing good default profiles and clear group boundaries.
