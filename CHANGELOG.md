# Changelog

All notable changes to Charlotte will be documented in this file.

## [0.7.0] - 2026-06-09

This release hardens Charlotte for untrusted pages, fixes a long tail of silent-failure and lifecycle bugs, cuts per-render overhead, and adds a JSON configuration file. Read the **Behavior changes** below before upgrading — two of them (sandbox default, element-ID format) can affect existing setups.

### Behavior changes

- **The Chromium sandbox is now ON by default.** Earlier releases baked `--no-sandbox` into every launch; the sandbox is the primary defense between an untrusted page and the account Charlotte runs as, so it is now enabled by default. Disable it explicitly with the `--no-sandbox` flag, `CHARLOTTE_NO_SANDBOX=1`, or `browser.noSandbox` in the config file. The provided Dockerfiles set `CHARLOTTE_NO_SANDBOX=1` (containers usually cannot set up the kernel sandbox), and `docker-compose.yml` no longer runs `seccomp=unconfined` — Docker's default syscall filter is restored. **Bare-metal-as-root users:** Chromium refuses to launch with the sandbox enabled when running as root; run as a non-root user or opt out explicitly. (#184)
- **Element-ID hashes are now 6 hex characters** (e.g. `btn-a3f1c2`), up from 4, drastically reducing cross-element collisions on large pages. This is a deliberate ID format change — re-`find` elements rather than reusing IDs cached from a pre-0.7.0 session. (#190)
- **`charlotte_fill_form` checkbox/radio/toggle now use set-semantics:** the desired state is expressed via `value` (`"true"`/`"false"`) and the element is only clicked when its current state differs, making fills idempotent. (#204)
- **Response-shape changes:** `charlotte_tab_open`, `charlotte_dev_serve`, and dialog responses now use the standard stripped, size-capped page format; the dialog page payload is no longer nested under a `page` key. (#204)
- **The dev static server now reports `127.0.0.1`** in its URL to match the address it actually binds. (#203)

### Added

- **JSON configuration file** via `--config <path>` (and an auto-loaded `charlotte.config.json` in the working directory). Settings resolve with precedence **CLI args > env vars > config file > defaults**, validated with zod; an invalid config produces a clear startup error on stderr and a non-zero exit. New env vars: `CHARLOTTE_NO_SANDBOX`, `CHARLOTTE_OUTPUT_DIR`, `CHARLOTTE_CDP_ENDPOINT`. See [docs/configuration.md](docs/configuration.md). (#19)
- **Configurable output-size caps** (`limits.maxInteractiveElements`, `limits.maxFullContentChars`, `limits.maxResponseBytes`, `limits.maxEvaluateBytes`) so large or adversarial pages can no longer overflow the client's context window. Page responses now carry a `truncation` marker and degrade to a compact summary (with an `output_file` suggestion) above the byte ceiling; `charlotte_evaluate` results are capped independently. (#188)
- **`output_file` support in `charlotte_find`** for large selector/match result sets. (#72)
- **`charlotte_screenshot` `full_page` option** (default true) for viewport-only capture. (#204)
- **Slow-typing duration guard** — `charlotte_type` now rejects slow-typing requests whose estimated duration would risk an MCP tool timeout, failing fast with `INVALID_ARGUMENT` instead of typing partway and timing out. The estimate (`text.length * character_delay`) is capped at 30s with a per-keystroke margin, and the `character_delay` schema description documents the ceiling. Fixes #127. (#174, #180)
- **Server instructions now advertise partially-enabled tool groups** (e.g. "interaction (7/13 enabled)"). (#204)
- **Tri-state checkbox state** — indeterminate checkboxes now report `state.checked: "mixed"` instead of collapsing to `true`. (#190)

### Changed

- **Crash recovery** — a Chromium crash no longer permanently wedges the server. The next tool call relaunches the browser, clears the dead tab and CDP-session caches, and opens a fresh blank tab automatically. (#201)
- **Render performance** — cut per-render CDP round-trips: file-input reclassification probes button candidates concurrently instead of one blocking `DOM.describeNode` per button; form-field association uses an O(1) reverse lookup instead of an O(forms x descendants x elements) scan; layout extraction deduplicates backend node IDs before issuing `DOM.getBoxModel` calls. (#194, #196, #199, #213)
- **`charlotte_key` sequences and full-speed `charlotte_type`** are now bounded by the typing-duration guard, preventing MCP timeouts on huge payloads. (#204)
- **`detail=minimal` interactive summary** now preserves per-landmark grouping for elements inside iframes instead of collapsing them into a single `(iframe)` bucket; main-frame landmark grouping is also retained when iframes are present. (#68)
- **Interaction helpers reuse the cached per-page CDP session** instead of creating and detaching their own. (#202)
- Centralized Puppeteer internal frame-session access behind a documented `frameClient()` helper, with smoke tests guarding against Puppeteer upgrades removing the internals it depends on (`Frame.client` / frame `_id` remain internal in puppeteer 24.x). (#84)

### Fixed

- **`charlotte_select`** now errors (`ELEMENT_NOT_FOUND`, listing valid options) instead of silently succeeding when the requested option does not exist. (#186)
- **`charlotte_submit`** performs a real native form submission via `form.requestSubmit()` for forms without a submit button, so plain server-rendered forms actually submit. (#189)
- **Dialog-race hangs** — `charlotte_type` (with `press_enter`), `charlotte_toggle`, `charlotte_select`, `charlotte_key`, `charlotte_fill_form`, and `charlotte_drag` no longer hang when an action triggers a JavaScript dialog; they surface `pending_dialog` like the click/submit tools. (#182)
- **`charlotte_drag`** now works when source and target are far apart: it scrolls the target into view mid-drag instead of pressing on stale source coordinates. (#185)
- **Same-origin iframe bounds** were double-offset by the iframe's position, making `charlotte_click_at` and reported bounds wrong; same-process iframes now share the main-frame coordinate space and only out-of-process (cross-origin) iframes get the content offset. (#183)
- **Collision-disambiguated element IDs** no longer migrate onto a base ID between renders (a salted hash replaces the traversal-order `-N` suffix), so cached IDs no longer resolve to the wrong element and the differ no longer reports phantom add/remove pairs. (#191)
- **Selector-mode (`dom-`) IDs from `charlotte_find`** are now durable: they survive subsequent renders/interactions, work with `fill_form`, and are re-resolved against the live DOM by re-running their selector; they are cleared on cross-document navigation. (#191)
- **`charlotte_find` reclassified file inputs** now carry the correct `inp-` prefix (was `btn-`), so `findSimilar` and prefix-based reasoning work. (#190)
- **Content summary** no longer reports a self-referential "1 forms" on the form you are viewing. (#190)
- **`charlotte_diff`** no longer reports spurious `content_summary` changes when comparing snapshots of different detail levels, truncates very long summary values, and keys landmark diffs by ID so duplicate unnamed landmarks are tracked independently. (#190)
- **`charlotte_wait_for` `state:"exists"`** no longer polls a frozen element-ID map; the `exists` and `removed` branches re-render on every poll so newly-appearing and truly-gone elements are detected. (#193)
- **`charlotte_wait_for` JS conditions** — a lambda (`() => ...`) instead of an expression now returns `INVALID_ARGUMENT` immediately; a condition that returns a non-serializable/cyclic result (e.g. `window`, or an object with a self-reference) now fails fast with `INVALID_ARGUMENT` instead of polling to `TIMEOUT` — only transient protocol errors (navigation/context teardown) are still treated as "not satisfied" and retried; expression exceptions during polling are surfaced in the `TIMEOUT` response instead of being folded into "condition not met"; the timeout response now strips empty fields like the success path. The same handling was applied to `pollUntilCondition` in `src/utils/wait.ts`. (#198)
- **Lifecycle / CDP resilience:** closing a tab whose page is already dead no longer hangs or leaks the entry; `charlotte_reload --hard` no longer times out on fast local pages or leaks its CDP session; `charlotte_back`/`charlotte_forward` correctly traverse same-URL history entries (e.g. SPA `pushState`); listing tabs no longer fails entirely when one tab's page is dead; concurrent page renders are serialized per page; cross-origin iframe navigations (OOPIF swaps) and detached CDP sessions are detected and refreshed. (#201, #202, #205)
- **`charlotte_network` URL blocking** was a no-op — `setBlockedURLs` now runs on the cached CDP session with Network explicitly enabled. (#192)
- **Argument-validation failures** across interaction/observation/dev tools now return `INVALID_ARGUMENT` instead of `SESSION_ERROR`, giving agents the correct "fixable by caller" recovery signal. (#187)
- **`charlotte_find` `near`/`within` filters** now error instead of silently returning unfiltered results when the reference element has no bounds. (#204)
- **`charlotte_type` `clear_first`** now reliably replaces existing text on macOS-hosted Chromium (was prepending due to Ctrl+A vs Cmd+A); selection now happens in page context, platform-independent. (#204)
- **`charlotte_toggle`** now rejects non-toggleable elements, pointing callers to `charlotte_click`. (#204)
- **`charlotte_wait_for`** now rejects `state` supplied without `element_id`. (#204)
- **Dev-mode hardening:** static-server path boundary uses a separator-anchored check (was bare `startsWith`, allowing prefix-match escapes); `express.static` no longer serves dotfiles (e.g. `.git/config`); `dev_audit` link checks filter private/loopback/link-local ranges to block SSRF via page-supplied hrefs; `charlotte_configure` validates `screenshot_dir`/`output_dir` against the workspace root; `resolveOutputPath` lstat-checks for pre-planted leaf symlinks; the artifact index validates IDs and writes atomically; `FileWatcher` post-ready errors are no longer swallowed and mid-reload changes schedule a trailing reload. (#203)

### Internal

- **Test infrastructure:** added a shared in-memory MCP harness (`tests/helpers/mcp-harness.ts`) and `pollUntil` waiter (`tests/helpers/poll.ts`); the integration suite now exercises tools through their real MCP handlers via `callTool` instead of reimplementing handler logic with raw CDP/Puppeteer. Eliminated fixed-sleep timing races in dialog, popup, monitoring, and keyboard tests by polling on observable state; capped the vitest fork pool to bound concurrent Chromium instances; fixed a stale-`ElementHandle` leak in `dialog.test.ts`. (#195, #206, #166)
- **New tests:** `tests/integration/agent-flow.test.ts` (end-to-end navigate→observe→find→click→type→fill_form→submit→back→forward→diff through MCP handlers); `tests/integration/handler-smoke.test.ts` (screenshot, monitoring, dev_mode); unit suites for the `content-extractor`, `layout-extractor`, `accessibility-extractor`, and `frame-discovery` renderer modules (99 new tests), pinning documented invariants (Chromium AX uses role `"image"` not `"img"`; null `backendDOMNodeId` skips layout extraction). vitest now excludes `.claude/**` worktrees from collection. (#195, #209)
- **CI:** coverage thresholds enforced by a new coverage job (global + stricter on `src/tools`); Puppeteer Chromium cached between runs (keyed on `package-lock.json`); test matrix on Node 20 and 22; the docker-publish workflow now builds the image, runs `tests/docker-smoke-test.mjs` against it, and only pushes on success; added an `npm audit --audit-level=high` job. (#207)
- Replaced CDP `send()` `as any` casts with proper types. (#171)
- Removed unused `Page`/`Network` CDP domain enables and a duplicated interactive-role set from the render session; made the `ZERO_BOUNDS` layout sentinel genuinely immutable; extracted a shared `clickAtCoordinates()` so click_at and element clicks share one implementation. (#204, #205)

## [0.6.3] - 2026-04-17

### Fixed

- **Republished with correct `dist/` artifacts** — The v0.6.2 tarball on npm was packaged from a stale `dist/` directory and did not actually include the `--cdp-endpoint` CLI option, iframe interaction, or other v0.6.2 source changes, despite those features being present at the v0.6.2 git tag. v0.6.3 ships the same intended feature set with the correct compiled output. No source-level changes versus v0.6.2. Fixes #164.

### Internal

- Added `prepublishOnly` script (`npm run build && npm test`) so `npm publish` rebuilds and re-tests before packaging, preventing stale-dist publishes.

## [0.6.2] - 2026-04-16

### Added

- **`--cdp-endpoint` CLI option** — Connect to a running Chrome/Chromium instance via its DevTools Protocol endpoint instead of launching a new browser. Supports raw `ws://` URLs and a `channel:chrome` shorthand that auto-discovers the endpoint. `BrowserManager` gains a connected mode that uses `puppeteer.connect()`, and `PageManager.adoptExistingPages()` picks up pre-existing tabs. Closes GAP-33. (#153)
- **Iframe interaction** — Interaction tools (click, type, select, toggle, submit, scroll, hover, key, wait_for, upload, fill_form) now work against elements inside child frames. Complements the iframe content extraction added in v0.5.0, so agents can both see and act on iframe contents. Closes #66. (#160)
- **CI workflow** — GitHub Actions workflow runs lint, typecheck, and full test suite on push and PR. Closes #56, #58. (#154)
- **End-to-end MCP protocol tests** — New test suite exercises the server over an in-memory MCP transport to catch protocol-level regressions. Closes #60. (#156)

### Changed

- **Reduced CDP session churn** — Interaction helpers no longer repeatedly attach/detach CDP sessions. Sessions are reused across calls, cutting per-action overhead. Closes #113. (#159)
- Applied Prettier formatting across all source and test files.
- Dependency updates: hono (#161), next (#152), basic-ftp (#151).

### Fixed

- **Cross-frame drag validation** — `charlotte_drag` now validates that source and target elements belong to the same frame and surfaces a `CharlotteError` instead of producing undefined mouse behavior. (#160)
- **Stale frame sessions in `CDPSessionManager`** — Frame sessions are now cleaned up when frames detach, and empty reverse-index entries are pruned. Prevents leaks when navigating pages with many iframes. Closes #67. (#155)
- **Batched startup `tool.disable()`** — Disabling tools at startup based on profile no longer floods the client with a `sendToolListChanged()` notification per tool. Mirrors the batching fix for runtime enable/disable in v0.6.1. (#158)
- **Viewport preserved on CDP connect** — When connecting via `--cdp-endpoint`, Charlotte no longer overrides the viewport of pages already open in the target browser.

### Internal

- Mixed-state group enable/disable tests added to cover partial-enable scenarios in the meta-tool. Closes #149. (#157)

## [0.6.1] - 2026-04-09

### Fixed

- **Runtime tool group activation** — Tools enabled via `charlotte_tools` were not callable by MCP clients. Each `tool.enable()` call triggered a separate `sendToolListChanged()` notification, flooding the client before the tool response was returned. Now batches state changes and sends a single notification per enable/disable action. Fixes #146. (#147)

### Changed

- Dependency updates: vite (#142), npm_and_yarn group (#144), basic-ftp (#145)

## [0.6.0] - 2026-04-03

### Added

- **`charlotte_fill_form`** — Batch form fill tool that accepts an array of `{element_id, value}` pairs and fills an entire form in a single tool call. Supports text inputs, textareas, selects, checkboxes, radios, toggles, date inputs, and color inputs. Closes GAP-04. (#134)
- **Slow typing** — `charlotte_type` now accepts `slowly` (boolean) and `character_delay` (ms) parameters for character-by-character input. Required for sites with key-by-key event handlers (autocomplete, search-as-you-type). Closes GAP-05. (#126)
- **Lazy Chromium initialization** — Browser launch is deferred to the first tool call instead of startup, preventing idle Chromium instances when MCP clients spawn multiple server processes simultaneously. (#138)
- **MCP logging capability** — Server now declares `logging: {}` capability so the MCP SDK handles `logging/setLevel` requests from clients. (#138)
- **CLI improvements** — Migrated to `node:util` `parseArgs`, added `--help` flag, improved `--no-headless` handling. (#130, #133)
- **Default viewport 1440×900** — Increased from 800×600 for more realistic rendering. Centralized viewport config with device presets. (#121)

### Changed

- **BREAKING: Tool name prefix migration** — All 43 MCP tool names renamed from `charlotte:xxx` to `charlotte_xxx` to comply with the MCP spec's `[A-Za-z0-9_.-]` character constraint and silence SDK v1.26.0+ validation warnings. Closes #57. (#139)
- **Node.js requirement relaxed to >=20** — No Node 22-only APIs are used. Opens Charlotte to the broader Node 20 LTS user base. (#136)
- Select options capped at 50 to prevent oversized responses. (#126)

### Fixed

- **`pollUntilCondition` JS evaluation** — Replaced `new Function("return " + expr)` with CDP `Runtime.evaluate` in the wait utility, fixing multi-statement silent-return bug. Consistent with `evaluate.ts` and `wait-for.ts`. (#135)
- **Screenshot stale compositor frame** — Flush compositor frame before capture to prevent stale screenshots on SPA page transitions. (#120)
- **Timer leak in `waitForCompositorFrame`** — `clearTimeout` moved to `finally` block. (#120)
- **CDP error logging** — Unexpected CDP errors in layout extraction are now logged instead of silently swallowed. (#117)
- **macOS symlink test paths** — File output integration tests resolve `/var` symlinks on macOS. (#122)
- **CVE-2026-31988** — Override yauzl to 3.2.1 to address zip extraction vulnerability. (#106)
- **Server version from package.json** — Version string is now read from `package.json` at module load instead of being hardcoded. (#101)

### Improved

- **Snapshot store O(1) lookup** — Added Map index for constant-time snapshot retrieval by ID. (#116)
- **Interaction module split** — `interaction.ts` refactored into focused modules for maintainability. (#112, #114)

## [0.5.1] - 2026-03-14

### Added

- **Popup and target="_blank" tab capture** — Clicks on `target="_blank"` links and `window.open()` calls were silently lost because PageManager had no `popup` event handler. New tabs are now auto-captured via `page.on("popup")`, auto-cleaned when pages close themselves, and surfaced as `opened_tabs` in tool responses using single-consumption semantics. Fixes #103, #98.
- **Contributor issue templates** — Bug report, feature request, and tool request templates added to the repository. Community links added to README. (#102)

### Changed

- Renamed AXIOM to ASM across Charlotte site (#100).
- Bumped hono dependency (#99).

## [0.5.0] - 2026-03-09

### Added

- **Iframe content extraction** — Child frames are now discovered and their content (interactive elements, content summaries, full text) is merged into the parent page representation. Configurable depth limit (default 3). Iframe interactive elements are included in the `interactive` array and `interactive_summary`. Closes #23.
- **Structural tree view** — `charlotte:observe` now accepts a `view` parameter with `"tree"` and `"tree-labeled"` modes that render the page as a hierarchical tree with indentation, replacing the flat JSON representation. Tree-labeled mode annotates interactive elements with their IDs for direct use.
- **File output for large responses** — `charlotte:observe` and `charlotte:screenshot` accept an `output_file` parameter to write results to disk instead of returning inline, reducing token consumption for large pages. Relative paths resolve against `output_dir` (configurable via `charlotte:configure` or `--output-dir` CLI flag). Closes GAP-13, #16.
- **Screenshot artifact management** — `charlotte:screenshots` (list), `charlotte:screenshot_get` (retrieve), `charlotte:screenshot_delete` (remove) tools for managing persistent screenshot files. `charlotte:screenshot` gains a `save` parameter for persistence.
- **Code quality tooling** — ESLint, Prettier, and coverage configuration added to the project.

### Fixed

- **`wait_for` JS evaluation** — Replaced `new Function("return " + expr)` with CDP `Runtime.evaluate`, fixing multi-statement JS conditions that silently returned `undefined` due to ASI. Now consistent with `charlotte:evaluate`. Fixes #73.
- **Browser reconnection race** — `getBrowser()` now calls `ensureConnected()` to auto-recover instead of throwing immediately. `ensureConnected()` verifies browser health after awaiting concurrent launches. Fixes #83.
- **Renderer pipeline resilience** — Malformed AX properties no longer crash accessibility extraction (#86). Content extraction skips failed nodes instead of aborting (#79). Recursive frame traversal catches errors per-frame (#74). Batch layout extraction uses `Promise.allSettled()` for partial failure tolerance (#77).
- **Event listener cleanup** — `closeTab()` now explicitly removes all page event listeners before `page.close()` to prevent memory leaks across tab cycles. Fixes #89.
- **Dialog handler error handling** — Dialog event handler wrapped in try/catch to prevent unhandled promise rejections when dialog is already dismissed. Fixes #75.
- **Dev mode shutdown resilience** — `DevModeState.stopAll()` catches errors per substep so a file watcher or static server failure doesn't prevent browser cleanup. Fixes #80.
- **Form field matching null guard** — `resolveId()` null return no longer produces false-positive form field matches. Fixes #76.
- **Landmark ID collision** — Main-frame landmarks now pass explicit `"main"` frameId for consistent hash input, preventing rare cross-frame ID collisions. Fixes #82.
- **CLI argument parsing** — `--output-dir=`, `--profile=`, and `--tools=` flags now use `substring(indexOf("=") + 1)` instead of `split("=")[1]`, preserving paths containing `=`. Fixes #70.
- **Zod bounds validation** — Added `.min()`/`.max()` constraints to `quality` (1-100), viewport `width`/`height` (>=1), and key `delay` (>=0). Fixes #81.
- **Test cleanup** — File output integration test no longer leaks artifact store temp directory. Fixes #71.
- **File output security** — Path traversal prevention, mkdir-before-validation fix, and CLI `output-dir` initialization hardened. Fixes security issues from #16 review.

### Changed

- README rewritten with problem-first opening, expanded MCP client setup configs (Cursor, Windsurf, VS Code, Cline, Amp), and updated tool counts.
- npm package description and keywords updated for discoverability.
- Site meta descriptions updated to lead with token-efficiency comparison.

## [0.4.2] - 2026-03-06

### Added

- **`charlotte:upload`** — Set files on `<input type="file">` elements via CDP `DOM.setFileInputFiles`. Validates file existence and element type before upload. Closes GAP-02 from the Playwright MCP gap analysis.
- **File input detection** — File inputs (`<input type="file">`) are now correctly identified as `file_input` type in page representations. Previously they appeared as `button` because Chromium's accessibility tree represents them with a button role. A post-extraction reclassification step checks the underlying DOM node.
- **`charlotte:key` enhancement** — Added `keys` (sequence of key presses), `element_id` (focus a specific element before sending keys), and `delay` (milliseconds between sequence presses) parameters. Enables keyboard-driven interaction with non-input elements like game UIs, terminals, and code editors. Closes #49, #51.

### Fixed

- **Boolean parameter validation error** — `charlotte:console` and `charlotte:requests` `clear` parameter (and `charlotte:type` `clear_first`/`press_enter`) rejected string-coerced booleans (`"true"`/`"false"`) sent by some MCP clients. All boolean parameters now accept both native booleans and their string representations. Fixes #50.
- **`click_at` skipped hover on framework-managed links** — `click_at` now moves the mouse to target coordinates and pauses 50ms before clicking, matching real user behavior. Previously, framework links (e.g., Next.js `<Link>`) that depend on hover-triggered prefetch would skip client-side navigation. Fixes #48.

### Changed

- Dialog integration tests hardened with MCP end-to-end testing via `InMemoryTransport`, sequential dialog coverage, and dialog-aware action racing tests. Test count 17 → 25. Closes #30, #33, #34.

## [0.4.1] - 2026-03-05

### Added

- **`charlotte:click_at`** — Click at specific page coordinates (x, y). Enables interaction with non-semantic elements (custom widgets, canvas regions, SVG graphics) that don't appear in the accessibility tree. Supports left/right/double click and modifier keys.
- **CSS selector mode for `charlotte:find`** — New `selector` parameter queries the DOM directly via `DOM.querySelectorAll`, returning elements with Charlotte IDs usable by all interaction tools. Complements the existing accessibility tree search for elements that lack semantic roles.

### Fixed

- **`charlotte:evaluate` silent null on multi-statement code** — Replaced `new Function('return ' + expr)` with CDP `Runtime.evaluate`, which evaluates JavaScript as a program and returns the completion value of the last expression-statement. The previous implementation suffered from ASI (Automatic Semicolon Insertion) silently converting `return\n...` into `return;`, causing multi-line scripts to return null without error.

## [0.4.0] - 2026-03-03

### Added

- **Tiered tool visibility** — Startup profiles control which tools load into the agent's context. `--profile=browse` (default, 22 tools) replaces the previous behavior of loading all 40 tools. Six profiles available: `core` (7), `browse` (22), `interact` (27), `develop` (30), `audit` (13), `full` (40). Granular group selection via `--tools=group1,group2`.
- **`charlotte:tools` meta-tool** — Runtime tool group management. Agents can list available groups, enable groups to activate tools mid-session, and disable groups to reduce overhead — without restarting the server. Always registered regardless of profile.
- **Profile benchmark suite** — `npx tsx benchmarks/run-benchmarks.ts --suite profiles` runs tool definition overhead benchmarks across full, browse, and core profiles. Four tests: pure overhead measurement, 5-site browsing session, form interaction, and runtime toggle correctness. Results archived under `benchmarks/results/raw/tiered-profiles-v1/`.
- **`charlotte:drag`** — Drag an element to another element using mouse primitives (mousedown → intermediate moves → mouseup). Accepts `source_id` and `target_id` element IDs. Closes GAP-01 from the Playwright MCP gap analysis.
- **Landmark IDs** — Landmarks now have stable hash-based IDs (`rgn-xxxx`) like headings and interactive elements, making them referenceable by tools (e.g., as drag-and-drop targets).
- **`charlotte:console`** — Retrieve console messages from the active page at all severity levels (log, info, warn, error, debug) with timestamps. Supports level filtering and buffer clearing. Closes GAP-21 from the Playwright MCP gap analysis.
- **`charlotte:requests`** — Retrieve network request history from the active page with method, status, resource type, and timestamps. Supports filtering by URL pattern, resource type, and minimum status code. Closes GAP-22 from the Playwright MCP gap analysis.
- **Modifier key clicks** — `charlotte:click` now accepts an optional `modifiers` parameter (`ctrl`, `shift`, `alt`, `meta`, or combinations) for Ctrl+Click, Shift+Click, etc. Works with all click types (left, right, double).

### Fixed

- **Pseudo-element content duplication** — `extractFullContent()` was emitting both content-role node names and their StaticText children, causing duplicate text when CSS `::before`/`::after` pseudo-elements were present.

### Changed

- Default startup profile is now `browse` (22 tools) instead of loading all 40 tools. Use `--profile=full` for the previous behavior.
- PageManager now captures all console messages and all network responses (not just errors). Ring buffers capped at 1000 entries each. Backward-compatible: `getConsoleErrors()` and `getNetworkErrors()` still return only errors for `PageRepresentation.errors`.
- Static server now binds to `127.0.0.1` instead of `0.0.0.0`, preventing external network access. Directory traversal prevention via `allowedWorkspaceRoot` validation with `fs.realpathSync()`.

## [0.3.0] - 2026-02-24

### Added

- **`charlotte:dialog`** — Accept or dismiss JavaScript dialogs (`alert`, `confirm`, `prompt`, `beforeunload`). Dialogs are captured by PageManager and surfaced as `pending_dialog` in every tool response while blocking. Response includes `dialog_handled` metadata confirming what was resolved. Closes GAP-03 from the Playwright MCP gap analysis.
- **Dialog-aware action racing** — Interaction tools (`click`, `submit`) now race the action against dialog detection. Clicks that trigger dialogs return immediately with `pending_dialog` instead of hanging for 30s.
- **`dialog_auto_dismiss` configuration** — New parameter on `charlotte:configure` to auto-handle dialogs without explicit tool calls. Options: `"none"` (default, queue for manual handling), `"accept_alerts"`, `"accept_all"`, `"dismiss_all"`.
- **Dialog-blocking stub responses** — When a dialog is open, `renderActivePage` returns a minimal stub representation (since `page.title()` hangs while dialogs are blocking). The stub includes `pending_dialog` so agents always know a dialog needs handling.

### Changed

- `PageManager` now accepts `CharlotteConfig` in its constructor for dialog auto-dismiss configuration.
- Config initialization moved before `PageManager` creation in `src/index.ts`.

## [0.2.0] - 2026-02-22

### Changed

- **Compact response format** — Responses are now dramatically smaller, reducing context window consumption by 50-99% depending on the page. Charlotte's `navigate` returns 336 characters for Hacker News vs Playwright MCP's 61,230.
- **Interactive summary for minimal detail** — Navigation tools now return interactive element counts grouped by landmark region instead of listing every element individually. Wikipedia's minimal response dropped from 711K to 7.7K characters.
- **Default state stripping** — Interactive elements no longer include redundant default state fields (`enabled: true`, `visible: true`, `focused: false`). Only non-default values are serialized.
- **Compact JSON serialization** — All tool responses use compact JSON with empty fields stripped.
- **Navigation defaults to minimal** — `navigate`, `back`, `forward`, and `reload` now return minimal detail by default. Pass `detail: "summary"` or `detail: "full"` for more context.
- **Updated tool descriptions** — `navigate` and `observe` descriptions now guide agents through the minimal-then-find workflow.

### Removed

- Removed unused `alerts` field from page representation.

## [0.1.3] - 2026-02-22

### Added

- Benchmark suite for comparing Charlotte against Playwright MCP across real websites.

## [0.1.2] - 2026-02-22

### Changed

- Added `mcpName` field for MCP registry publishing.

## [0.1.1] - 2026-02-22

### Added

- **`get_cookies`** — Retrieve cookies for the active page with optional URL filtering. Returns cookie name, value, domain, path, and security flags.
- **`clear_cookies`** — Clear cookies from the browser with optional name filtering. Supports clearing all cookies or specific cookies by name.

### Fixed

- Session integration tests now use HTTP URLs for cookie operations (CDP requires http/https for `Network.deleteCookies`).

## [0.1.0] - 2026-02-13

Initial release. All six implementation phases complete.

### Tools

**Navigation**: `navigate`, `back`, `forward`, `reload`

**Observation**: `observe` (minimal/summary/full detail levels, CSS selector scoping, computed styles), `find` (text, role, type, spatial near/within filters), `screenshot` (PNG/JPEG/WebP, element or full page), `diff` (structural comparison against snapshots)

**Interaction**: `click` (left/right/double), `type` (with clear_first, press_enter), `select`, `toggle`, `submit`, `scroll` (page/container, directional), `hover`, `key` (with modifiers), `wait_for` (element state, text, selector, JS expression)

**Session**: `tabs`, `tab_open`, `tab_switch`, `tab_close`, `set_cookies`, `set_headers`, `viewport` (mobile/tablet/desktop presets), `network` (3G/4G/offline throttling, URL blocking), `configure` (snapshot depth, auto-snapshot mode)

**Development**: `dev_serve` (static server + file watching with auto-reload), `dev_inject` (CSS/JS injection with delta), `dev_audit` (a11y, performance, SEO, contrast, broken links)

**Utilities**: `evaluate` (JS execution with timeout and promise awaiting)

### Architecture

- Renderer pipeline: accessibility tree + layout geometry + interactive element extraction
- Hash-based element IDs stable across re-renders
- Snapshot store with ring buffer and structural diffing
- Chromium crash recovery with automatic relaunch
- Dev mode reload events surfaced through existing tool responses (zero integration overhead)

### Testing

222 tests across 19 test files (unit + integration).
