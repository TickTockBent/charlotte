/**
 * CLI argument parsing for Charlotte.
 *
 * Extracted from index.ts so it can be tested without triggering
 * the main() side effect.
 */

import { parseArgs } from "node:util";
import { logger } from "./utils/logger.js";
import type { ToolProfile, ToolGroupName } from "./tools/tool-groups.js";

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
  --profile <name>       Tool profile (default: browse)
                         Profiles: ${VALID_PROFILES.join(", ")}
  --tools <groups>       Comma-separated tool groups to enable
                         Groups: ${VALID_GROUPS.join(", ")}
  --output-dir <path>    Directory for output files (screenshots, logs)
  --no-headless          Show the browser window (default: headless)
  --cdp-endpoint <url>   Connect to an existing Chrome via CDP endpoint
                         (http://..., ws://..., or channel:chrome)
  --help                 Show this help message
`;

export function parseCliArgs(argv: string[] = process.argv.slice(2)): {
  profile?: ToolProfile;
  toolGroups?: ToolGroupName[];
  outputDir?: string;
  headless: boolean;
  cdpEndpoint?: string;
} {
  const { values } = parseArgs({
    args: argv,
    options: {
      profile: { type: "string" },
      tools: { type: "string" },
      "output-dir": { type: "string" },
      "no-headless": { type: "boolean", default: false },
      "cdp-endpoint": { type: "string" },
      help: { type: "boolean", default: false },
    },
    strict: false,
  });

  if (values.help) {
    process.stderr.write(HELP_TEXT);
    process.exit(0);
  }

  const profileValue = values.profile as string | undefined;
  const toolsValue = values.tools as string | undefined;
  const outputDir = values["output-dir"] as string | undefined;
  const headless = !values["no-headless"];
  const cdpEndpoint = values["cdp-endpoint"] as string | undefined;

  if (profileValue && toolsValue) {
    logger.warn("Both --profile and --tools provided; --profile takes precedence");
  }

  if (profileValue) {
    const profile = profileValue as ToolProfile;
    if (!VALID_PROFILES.includes(profile)) {
      throw new Error(`Invalid profile: ${profile}. Valid profiles: ${VALID_PROFILES.join(", ")}`);
    }
    return { profile, outputDir, headless, cdpEndpoint };
  }

  if (toolsValue) {
    const groups = toolsValue.split(",") as ToolGroupName[];
    for (const group of groups) {
      if (!VALID_GROUPS.includes(group)) {
        throw new Error(`Invalid tool group: ${group}. Valid groups: ${VALID_GROUPS.join(", ")}`);
      }
    }
    return { toolGroups: groups, outputDir, headless, cdpEndpoint };
  }

  // Default: no profile or groups specified — createServer defaults to browse
  return { outputDir, headless, cdpEndpoint };
}
