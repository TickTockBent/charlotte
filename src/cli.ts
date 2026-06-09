/**
 * CLI argument parsing for Charlotte.
 *
 * Extracted from index.ts so it can be tested without triggering
 * the main() side effect.
 *
 * `parseCliInputs` is the primary entry point used by config resolution
 * (issue #19): it returns only the values the user *explicitly* passed,
 * so absent flags fall through to env vars / config file / defaults.
 *
 * `parseCliArgs` is retained as a backward-compatible convenience that
 * applies built-in defaults (notably `headless: true`).
 */

import { parseArgs } from "node:util";
import { logger } from "./utils/logger.js";
import type { ToolProfile, ToolGroupName } from "./tools/tool-groups.js";
import type { CliInputs } from "./config/resolve.js";

const VALID_PROFILES: ToolProfile[] = ["core", "browse", "interact", "develop", "audit", "full"];

const VALID_GROUPS: ToolGroupName[] = [
  "navigation",
  "observation",
  "interaction",
  "session",
  "dev_mode",
  "dialog",
  "evaluate",
  "monitoring",
];

const HELP_TEXT = `Charlotte — token-efficient MCP browser automation server

Usage: charlotte [options]

Options:
  --config <path>        Load settings from a JSON config file
                         (default: charlotte.config.json in the cwd, if present)
  --profile <name>       Tool profile (default: browse)
                         Profiles: ${VALID_PROFILES.join(", ")}
  --tools <groups>       Comma-separated tool groups to enable
                         Groups: ${VALID_GROUPS.join(", ")}
  --output-dir <path>    Directory for output files (screenshots, logs)
  --no-headless          Show the browser window (default: headless)
  --no-sandbox           Disable the Chromium sandbox (default: sandbox ON).
                         Only needed in containers; weakens isolation from
                         untrusted pages. Env: CHARLOTTE_NO_SANDBOX=1
  --cdp-endpoint <url>   Connect to an existing Chrome via CDP endpoint
                         (http://..., ws://..., or channel:chrome)
  --help                 Show this help message
`;

const CDP_PREFIXES = ["http://", "https://", "ws://", "wss://", "channel:"];

interface RawCliValues {
  config?: string;
  profile?: string;
  tools?: string;
  "output-dir"?: string;
  "no-headless"?: boolean;
  "no-sandbox"?: boolean;
  "cdp-endpoint"?: string;
  help?: boolean;
}

function rawParse(argv: string[]): RawCliValues {
  const { values } = parseArgs({
    args: argv,
    options: {
      config: { type: "string" },
      profile: { type: "string" },
      tools: { type: "string" },
      "output-dir": { type: "string" },
      "no-headless": { type: "boolean" },
      "no-sandbox": { type: "boolean" },
      "cdp-endpoint": { type: "string" },
      help: { type: "boolean" },
    },
    strict: false,
  });
  return values as RawCliValues;
}

function resolveProfileAndGroups(values: RawCliValues): {
  profile?: ToolProfile;
  toolGroups?: ToolGroupName[];
} {
  const profileValue = values.profile;
  const toolsValue = values.tools;

  if (profileValue && toolsValue) {
    logger.warn("Both --profile and --tools provided; --profile takes precedence");
  }

  if (profileValue) {
    const profile = profileValue as ToolProfile;
    if (!VALID_PROFILES.includes(profile)) {
      throw new Error(`Invalid profile: ${profile}. Valid profiles: ${VALID_PROFILES.join(", ")}`);
    }
    return { profile };
  }

  if (toolsValue) {
    const groups = toolsValue.split(",") as ToolGroupName[];
    for (const group of groups) {
      if (!VALID_GROUPS.includes(group)) {
        throw new Error(`Invalid tool group: ${group}. Valid groups: ${VALID_GROUPS.join(", ")}`);
      }
    }
    return { toolGroups: groups };
  }

  return {};
}

function validateCdpEndpoint(cdpEndpoint: string, values: RawCliValues): void {
  if (!CDP_PREFIXES.some((prefix) => cdpEndpoint.startsWith(prefix))) {
    throw new Error(
      `Invalid --cdp-endpoint: ${cdpEndpoint}. Must start with one of: ${CDP_PREFIXES.join(", ")}`,
    );
  }
  if (values["no-headless"]) {
    logger.warn(
      "--no-headless has no effect in CDP mode; the remote browser controls its own display",
    );
  }
}

/**
 * Parse CLI arguments into explicit `CliInputs` (only the flags actually
 * passed) plus the optional `--config` path. This is the parser used by
 * config resolution so absent flags don't override lower-precedence
 * sources.
 */
export function parseCliInputs(argv: string[] = process.argv.slice(2)): {
  cli: CliInputs;
  configPath?: string;
} {
  const values = rawParse(argv);

  if (values.help) {
    process.stderr.write(HELP_TEXT);
    process.exit(0);
  }

  const { profile, toolGroups } = resolveProfileAndGroups(values);

  const cdpEndpoint = values["cdp-endpoint"];
  if (cdpEndpoint !== undefined) {
    validateCdpEndpoint(cdpEndpoint, values);
  }

  const cli: CliInputs = {};
  if (profile !== undefined) cli.profile = profile;
  if (toolGroups !== undefined) cli.toolGroups = toolGroups;
  if (values["output-dir"] !== undefined) cli.outputDir = values["output-dir"];
  // --no-headless sets headless=false; absence leaves headless unset (tri-state).
  if (values["no-headless"] === true) cli.headless = false;
  if (values["no-sandbox"] === true) cli.noSandbox = true;
  if (cdpEndpoint !== undefined) cli.cdpEndpoint = cdpEndpoint;

  return { cli, configPath: values.config };
}

/**
 * Backward-compatible parser that applies built-in defaults. Prefer
 * `parseCliInputs` + config resolution for new code.
 */
export function parseCliArgs(argv: string[] = process.argv.slice(2)): {
  profile?: ToolProfile;
  toolGroups?: ToolGroupName[];
  outputDir?: string;
  headless: boolean;
  cdpEndpoint?: string;
} {
  const { cli } = parseCliInputs(argv);

  const result: {
    profile?: ToolProfile;
    toolGroups?: ToolGroupName[];
    outputDir?: string;
    headless: boolean;
    cdpEndpoint?: string;
  } = { headless: cli.headless ?? true };

  if (cli.profile !== undefined) result.profile = cli.profile;
  if (cli.toolGroups !== undefined) result.toolGroups = cli.toolGroups;
  if (cli.outputDir !== undefined) result.outputDir = cli.outputDir;
  if (cli.cdpEndpoint !== undefined) result.cdpEndpoint = cli.cdpEndpoint;

  return result;
}
