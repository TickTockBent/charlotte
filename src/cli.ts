/**
 * CLI argument parsing for Charlotte.
 *
 * Extracted from index.ts so it can be tested without triggering
 * the main() side effect.
 */

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

export function parseCliArgs(argv: string[] = process.argv.slice(2)): {
  profile?: ToolProfile;
  toolGroups?: ToolGroupName[];
  outputDir?: string;
} {
  const profileArg = argv.find((a) => a.startsWith("--profile="));
  const toolsArg = argv.find((a) => a.startsWith("--tools="));
  const outputDirArg = argv.find((a) => a.startsWith("--output-dir="));

  if (profileArg && toolsArg) {
    logger.warn("Both --profile and --tools provided; --profile takes precedence");
  }

  const outputDir = outputDirArg
    ? outputDirArg.substring(outputDirArg.indexOf("=") + 1)
    : undefined;

  if (profileArg) {
    const profile = profileArg.substring(profileArg.indexOf("=") + 1) as ToolProfile;
    if (!VALID_PROFILES.includes(profile)) {
      throw new Error(`Invalid profile: ${profile}. Valid profiles: ${VALID_PROFILES.join(", ")}`);
    }
    return { profile, outputDir };
  }

  if (toolsArg) {
    const groups = toolsArg
      .substring(toolsArg.indexOf("=") + 1)
      .split(",") as ToolGroupName[];
    for (const group of groups) {
      if (!VALID_GROUPS.includes(group)) {
        throw new Error(`Invalid tool group: ${group}. Valid groups: ${VALID_GROUPS.join(", ")}`);
      }
    }
    return { toolGroups: groups, outputDir };
  }

  // Default: no profile or groups specified — createServer defaults to browse
  return { outputDir };
}
