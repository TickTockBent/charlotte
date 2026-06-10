/**
 * Config-file and environment loading for Charlotte (issues #19, #184).
 *
 * These are the filesystem/environment-touching wrappers around the pure
 * merge logic in `resolve.ts`.
 */

import { readFileSync, existsSync } from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { CharlotteFileConfigSchema, type CharlotteFileConfig } from "./schema.js";
import type { EnvInputs } from "./resolve.js";

/** Default config filename looked up in the working directory. */
export const DEFAULT_CONFIG_FILENAME = "charlotte.config.json";

/** Raised when the config file is missing, malformed, or fails validation. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Parse and validate raw JSON text against the config schema. Throws a
 * `ConfigError` with a human-readable message on any failure.
 */
export function parseConfigContent(raw: string, sourcePath: string): CharlotteFileConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ConfigError(`Failed to parse config file ${sourcePath}: ${(error as Error).message}`);
  }

  const result = CharlotteFileConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => {
        const location = issue.path.length > 0 ? issue.path.join(".") : "(root)";
        return `  - ${location}: ${issue.message}`;
      })
      .join("\n");
    throw new ConfigError(`Invalid config file ${sourcePath}:\n${issues}`);
  }

  return result.data;
}

/**
 * Resolve which config file to read, then read + validate it.
 *
 * @param explicitPath  Path from `--config <path>`. When provided, the file
 *                      MUST exist and be valid (a missing file is an error).
 * @param cwd           Working directory for the default-filename lookup.
 * @returns The validated config, or an empty config `{}` when no explicit
 *          path was given and no default file exists.
 */
export function loadConfigFile(
  explicitPath: string | undefined,
  cwd: string = process.cwd(),
): CharlotteFileConfig {
  let targetPath: string | undefined;

  if (explicitPath !== undefined) {
    targetPath = path.resolve(cwd, explicitPath);
    if (!existsSync(targetPath)) {
      throw new ConfigError(`Config file not found: ${targetPath}`);
    }
  } else {
    const defaultPath = path.resolve(cwd, DEFAULT_CONFIG_FILENAME);
    if (existsSync(defaultPath)) {
      targetPath = defaultPath;
    }
  }

  if (targetPath === undefined) {
    return {};
  }

  let raw: string;
  try {
    raw = readFileSync(targetPath, "utf-8");
  } catch (error) {
    throw new ConfigError(`Failed to read config file ${targetPath}: ${(error as Error).message}`);
  }

  return parseConfigContent(raw, targetPath);
}

/** Booleans accepted as "true" for env flags. */
const TRUTHY_ENV_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSY_ENV_VALUES = new Set(["0", "false", "no", "off", ""]);

const EnvSchema = z.object({
  CHARLOTTE_NO_SANDBOX: z.string().optional(),
  CHARLOTTE_OUTPUT_DIR: z.string().optional(),
  CHARLOTTE_CDP_ENDPOINT: z.string().optional(),
});

/**
 * Read Charlotte-relevant environment variables into `EnvInputs`.
 * Unknown/empty values are treated as unset so they don't clobber the
 * config file or defaults.
 */
export function readEnvInputs(env: NodeJS.ProcessEnv = process.env): EnvInputs {
  const parsed = EnvSchema.parse(env);

  let noSandbox: boolean | undefined;
  const rawNoSandbox = parsed.CHARLOTTE_NO_SANDBOX?.trim().toLowerCase();
  if (rawNoSandbox !== undefined) {
    if (TRUTHY_ENV_VALUES.has(rawNoSandbox)) {
      noSandbox = true;
    } else if (FALSY_ENV_VALUES.has(rawNoSandbox)) {
      noSandbox = false;
    } else {
      throw new ConfigError(
        `Invalid CHARLOTTE_NO_SANDBOX value: "${parsed.CHARLOTTE_NO_SANDBOX}". Expected a boolean (1/0, true/false).`,
      );
    }
  }

  const outputDir = parsed.CHARLOTTE_OUTPUT_DIR?.trim() || undefined;
  const cdpEndpoint = parsed.CHARLOTTE_CDP_ENDPOINT?.trim() || undefined;

  return { noSandbox, outputDir, cdpEndpoint };
}
