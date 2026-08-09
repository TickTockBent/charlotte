# Charlotte Benchmark Suite — Specification Draft

## Overview

Two complementary benchmark categories for evaluating browser MCP tools:

1. **Budget Benchmarks** — How much real work gets done within a fixed token budget?
2. **Capability Benchmarks** — Can the agent complete specific task types effectively?

Both benchmarks are designed to be tool-agnostic. Any browser MCP tool can be evaluated against them. The test pages, tasks, and success criteria are defined independently of the tool being measured.

---

## Benchmark 1: Tasks Completed Under Budget

### Concept

Give an agent a real workload and a fixed token budget. Count how far it gets.

This measures what practitioners actually care about: not how many tokens a single page costs, but how much useful work gets accomplished before the budget runs out or the context window fills.

### Setup

- **Target site:** A controlled test site with known pages, forms, navigation, and intentional issues. Using a live site introduces variability across runs. A static test site ensures reproducibility.
- **Agent:** Same model (e.g. Claude Sonnet), same system prompt, same task instructions. Only the browser tool changes.
- **Budget tiers:** Measure at multiple token budgets to show scaling curves.

### Proposed Budget Tiers

| Tier | Input Token Budget | Approximate Cost (Opus) |
|------|-------------------|------------------------|
| Minimal | 50,000 tokens | ~$0.25 |
| Standard | 200,000 tokens | ~$1.00 |
| Extended | 1,000,000 tokens | ~$5.00 |

### Task: Full Site Verification

The agent receives a single instruction:

> "Verify every page on this site. For each page, confirm the layout renders correctly, all forms submit successfully with valid input, all navigation links resolve, and flag any accessibility issues you find. Report your findings per page."

The agent must:
1. Discover all pages (crawl or use sitemap)
2. Navigate to each page
3. Observe and assess layout
4. Identify and test any forms
5. Verify navigation links
6. Note accessibility concerns
7. Report findings

### Measurements

- **Pages completed:** How many pages were fully verified before budget exhaustion?
- **Issues found:** How many real issues were identified? (Compared against known planted issues on the test site)
- **False positives:** How many non-issues were flagged?
- **Budget consumed:** Exact input/output tokens used
- **Cost:** Dollar cost at the model's published rates

### Test Site Design

The test site should include:
- 20-50 pages of varying complexity (simple landing pages, dense dashboards, form-heavy admin pages)
- Known planted issues:
  - 3-5 broken navigation links
  - 2-3 forms with validation bugs (e.g. accepts empty required fields)
  - 3-5 accessibility violations (missing alt text, low contrast, missing labels)
  - 1-2 layout issues (overflow, misalignment)
- A mix of page types:
  - Static content pages
  - Pages with interactive elements (tabs, accordions, modals)
  - Multi-field forms (contact, registration, settings)
  - Data tables
  - Navigation-heavy pages (menus, sidebars, breadcrumbs)

### Scaling Curve

Run at each budget tier and plot: pages completed vs tokens consumed. The slope of this curve is the tool's efficiency under real workload. A tool with compact representations should show a flatter cost-per-page, meaning more pages completed at every budget tier.

### Dollar Value Metric

Derived metric: **pages verified per dollar.** This is the number practitioners and managers understand immediately.

---

## Benchmark 2: Capability Benchmarks

### Concept

Discrete tasks testing specific capabilities. Each task has a clear pass/fail criteria and measures both success rate and token cost.

### Category A: Information Retrieval

Can the agent extract specific information from a page?

| Task | Success Criteria | Notes |
|------|-----------------|-------|
| Find the third h2 heading on a content page | Correct heading text returned | Tests observation accuracy |
| Count the number of forms on a page | Correct count | Tests structural understanding |
| Find all external links in the main content area | Complete list, no nav/footer links | Tests landmark-scoped search |
| Extract the price from a product page | Correct price value | Tests targeted content extraction |
| Identify which form fields are required | Correct list of required fields | Tests form structure parsing |

### Category B: Interaction Completion

Can the agent successfully interact with page elements?

| Task | Success Criteria | Notes |
|------|-----------------|-------|
| Fill and submit a contact form with valid data | Success message observed | Tests basic form workflow |
| Fill a form, submit with empty required field, report validation error | Correct error message reported | Tests error state observation |
| Click a tab/accordion to reveal hidden content, report what's inside | Correct hidden content reported | Tests state change + observation |
| Select an option from a dropdown, verify selection persisted | Correct option shown as selected | Tests select interaction |
| Navigate a pagination control to page 3, report content | Correct page 3 content | Tests multi-step navigation |

### Category C: State Verification

Can the agent detect what changed after an action?

| Task | Success Criteria | Notes |
|------|-----------------|-------|
| Click a toggle and report what changed on the page | Correct state change identified | Tests diff capability |
| Submit a form and identify whether the page showed success or error | Correct outcome reported | Tests post-action observation |
| Add an item to a cart and verify the cart count updated | Correct count change | Tests dynamic content tracking |
| Switch to dark mode and report which elements changed styling | Identifies themed elements | Tests visual state awareness |
| Close a modal and verify it's no longer visible | Confirms modal dismissed | Tests element visibility tracking |

### Category D: Exploration

Can the agent systematically discover and catalog page content?

| Task | Success Criteria | Notes |
|------|-----------------|-------|
| Find every form on a 10-page site | All forms found, none missed | Tests crawl + discovery |
| Identify all unique page layouts across a site | Correct layout categorization | Tests structural comparison |
| Find all pages with accessibility violations | Matches known violation list | Tests audit capability at scale |
| Map the full navigation structure of a site | Correct sitemap produced | Tests systematic traversal |
| Find all instances of a specific component (e.g. "pricing card") | Correct count and locations | Tests semantic search across pages |

### Category E: Multi-Step Workflows

Can the agent complete realistic sequences that compound across multiple pages?

| Task | Success Criteria | Notes |
|------|-----------------|-------|
| Register a new account, then log in with those credentials | Successfully logged in | Tests form + navigation + state |
| Add 3 items to cart, go to checkout, verify cart contents | All 3 items present at checkout | Tests state persistence across pages |
| Change a setting, navigate away, return, verify setting persisted | Setting still applied | Tests cross-page state verification |
| Find a broken link in the nav, report which page has it and where it points | Correct broken link identified | Tests exploration + error detection |
| Complete a multi-step form wizard (3+ pages) | Final confirmation page reached | Tests sequential interaction |

### Measurements Per Task

- **Pass/fail:** Did the agent complete the task correctly?
- **Input tokens consumed:** Total input tokens for the task
- **Output tokens consumed:** Total output tokens for the task
- **Tool calls:** Number of browser tool invocations
- **Elapsed time:** Wall clock time to completion
- **Cost:** Dollar cost at published model rates

### Aggregate Metrics

- **Success rate per category:** % of tasks completed correctly
- **Average tokens per task per category:** Efficiency under real use
- **Cost per successful task:** Only counting tasks that passed
- **Failure modes:** Categorize failures (context overflow, incorrect observation, interaction failure, timeout)

---

## Fairness Constraints

To ensure valid comparison across browser tools:

1. **Same model, same prompt.** The agent's system prompt and task instructions must be identical across tools. Only the browser tool configuration changes.
2. **No tool-specific features in tasks.** Tasks should not require capabilities unique to one tool (e.g. no dev_audit tasks if comparing against tools without audit features, no iframe tasks until all compared tools support them).
3. **Public pages or controlled test site.** Either use a static test site that ships with the benchmark, or use well-known public pages that won't change between runs.
4. **Multiple runs.** Each task should be run 3-5 times to account for LLM non-determinism. Report mean and variance.
5. **Published methodology.** Raw token counts, tool call logs, and agent transcripts should be available for review.

---

## Test Site Specification

A purpose-built static site that ships with the benchmark suite. Characteristics:

- **Hosted and versioned.** Available at a stable URL with version pinning so results are comparable across time.
- **No authentication required.** All pages publicly accessible.
- **No JavaScript framework dependencies.** Static HTML/CSS/JS to eliminate rendering variability.
- **Planted issues are documented in a sealed answer key.** Not published in the repo itself — kept separate so agents can't access it during runs. Available for result verification.
- **Varying complexity per page.** Simple pages (< 10 interactive elements) through complex pages (100+ interactive elements) to test scaling behavior.
- **Responsive.** Pages must render at desktop and mobile viewports for responsive testing tasks.

---

## Proposed Execution

### Phase 1: Build the test site
Design and build the static benchmark site with known pages, forms, planted issues, and documented answer key.

### Phase 2: Define the harness
Build a lightweight test runner that:
- Configures the agent with the specified model and prompt
- Swaps the browser tool configuration
- Logs all token usage, tool calls, and agent responses
- Enforces budget limits for Budget Benchmark runs
- Records pass/fail against the answer key for Capability Benchmark tasks

### Phase 3: Run Charlotte
Execute both benchmark suites against Charlotte. Publish full results with methodology.

### Phase 4: Invite comparison
Publish the benchmark suite openly. Anyone can run it against any browser tool and submit results. Charlotte's results are the first published baseline.

---

## Reporting Format

Results should be published as:

1. **Summary table** — Tool name, benchmark version, model used, aggregate scores
2. **Budget curve** — Pages completed vs tokens consumed at each budget tier
3. **Capability matrix** — Pass/fail per task, per category, with token costs
4. **Dollar efficiency** — Pages verified per dollar, tasks completed per dollar
5. **Raw data** — Full token logs and agent transcripts for reproducibility
