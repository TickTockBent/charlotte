/**
 * Public entry point for Charlotte's configuration system (issue #19).
 *
 * `loadStartupConfig` ties together CLI parsing, env reading, and config
 * file loading into a single resolved options object, applying the
 * precedence CLI > env > config file > defaults.
 */

import { parseCliInputs } from "../cli.js";
import { loadConfigFile, readEnvInputs } from "./load-config.js";
import { resolveOptions, type ResolvedOptions } from "./resolve.js";

export { ConfigError, DEFAULT_CONFIG_FILENAME } from "./load-config.js";
export type { ResolvedOptions, CliInputs, EnvInputs } from "./resolve.js";
export type { CharlotteFileConfig } from "./schema.js";

/**
 * Parse CLI args, read env vars, load the config file (explicit `--config`
 * or the default `charlotte.config.json` in cwd), and merge everything.
 *
 * Throws `Error`/`ConfigError` on invalid CLI args or invalid config; the
 * caller (index.ts) is responsible for printing the message to stderr and
 * exiting, since stdout is reserved for the MCP transport.
 */
export function loadStartupConfig(
  argv: string[] = process.argv.slice(2),
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): ResolvedOptions {
  const { cli, configPath } = parseCliInputs(argv);
  const envInputs = readEnvInputs(env);
  const fileConfig = loadConfigFile(configPath, cwd);
  return resolveOptions(cli, envInputs, fileConfig);
}
