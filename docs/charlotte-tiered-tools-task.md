# Task: Implement Tiered Tool Visibility

## Summary

Charlotte currently registers all 39 tools at startup, costing ~7-9k tokens of context before the agent sends its first message. Implement startup profiles and a runtime meta-tool so agents only pay for the tools they need.

## Reference Document

Read `/docs/charlotte-tiered-tools-analysis.md` for the full analysis, design rationale, and implementation sketches. This task implements the "Recommended Strategy: Profiles + Meta-Tool" described there.

## What to Build

### 1. Tool Groups

Define a mapping of group names to tool names:

- `navigation`: navigate, back, forward, reload
- `observation`: observe, find, screenshot (all variants), diff
- `interaction`: click, type, select, toggle, submit, scroll, hover, drag, key, wait_for
- `session`: cookies (get/set/clear), headers, configure, tabs (list/new/switch/close), viewport, network
- `dev_mode`: dev_serve, dev_inject, dev_audit
- `dialog`: dialog
- `evaluate`: evaluate
- `monitoring`: console, requests

### 2. Profiles

Profiles are named sets of groups. Add a `ToolProfile` type and a resolver:

| Profile | Groups included |
|---------|----------------|
| `core` | navigation, observation (observe + find only) |
| `browse` | navigation, observation, interaction (click + type + select + toggle + submit + scroll only) |
| `interact` | navigation, observation, interaction (all) |
| `develop` | navigation, observation, interaction (all), dev_mode |
| `audit` | navigation, observation (observe + find + screenshot + diff), dev_mode (dev_audit only), session (viewport only) |
| `full` | everything |

Note: some profiles include partial groups (e.g., `browse` includes scroll but not drag). The group mapping needs to support this — either sub-groups or per-profile tool lists.

### 3. CLI Argument Parsing

Parse `--profile=<name>` from `process.argv`. Default to `browse` if no argument provided. `--profile=full` restores current behavior.

Also support `--tools=navigation,interaction,dev_mode` for granular group selection as an alternative to named profiles.

### 4. Refactor Tool Registration

Each `register*Tools` function currently returns void. Refactor so they return references to the registered tool objects (the return value of `server.registerTool()`). Store these in a structure the meta-tool can access.

After all tools are registered, disable any that aren't in the active profile. This means all tools are registered (so they can be enabled later via the meta-tool) but only profile tools are visible in `tools/list`.

### 5. The `charlotte:tools` Meta-Tool

Always registered regardless of profile. Three actions:

- `list` (default): Returns all groups with their current enabled/disabled status and what tools they contain
- `enable`: Enables all tools in a group, triggers `list_changed`
- `disable`: Disables all tools in a group, triggers `list_changed`

The tool description should hint at when to enable groups, e.g.: "Enable 'interaction' for form filling and clicking. Enable 'session' for cookie/auth management and tab switching. Enable 'dev_mode' for local development serving and audits."

### 6. Server Instructions

Set the MCP server `instructions` field to indicate the active profile and list available groups the agent can enable via `charlotte:tools`.

## What NOT to Change

- Don't change any existing tool behavior, schemas, or handlers
- Don't change the module file structure (tools still live in their current files)
- Don't remove the ability to run with all tools (`--profile=full`)

## Testing

- Verify `--profile=browse` only exposes the expected tools in `tools/list`
- Verify `--profile=full` exposes all 39 tools (backward compatible)
- Verify `charlotte:tools` list action returns correct group status
- Verify `charlotte:tools` enable/disable toggles tool visibility
- Verify no argument defaults to `browse` profile
- Verify `--tools=navigation,observation` works for granular selection
- Existing test suite should still pass (may need `--profile=full` or config adjustment in test setup)

## Files Likely Touched

- `src/index.ts` — CLI arg parsing, pass profile to server creation
- `src/server.ts` — Accept profile, conditional registration, store tool refs
- `src/tools/*.ts` — Return tool references from register functions
- New: `src/tools/tool-groups.ts` — Group definitions, profile definitions, resolver
- New: `src/tools/meta-tool.ts` — The `charlotte:tools` handler
- `tests/` — New tests for profiles and meta-tool, possibly test setup changes
