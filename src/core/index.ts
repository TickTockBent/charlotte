/**
 * The assembled Charlotte tool core — the single source of truth for every
 * transport.
 *
 * Order matters: it is the order tools are registered in, and therefore the
 * order they appear in `tools/list`. It mirrors the historical registration
 * order in `createServer` exactly (evaluate, navigation, observation,
 * interaction — which ends with wait_for — dialog, session, monitoring,
 * dev-mode).
 */

import type { ToolDefinition } from "./types.js";
import { evaluateTools } from "./evaluate.js";
import { navigationTools } from "./navigation.js";
import { observationTools } from "./observation.js";
import { interactionTools } from "./interaction.js";
import { dialogTools } from "./dialog.js";
import { sessionTools } from "./session.js";
import { monitoringTools } from "./monitoring.js";
import { devModeTools } from "./dev-mode.js";

export const charlotteTools: ToolDefinition[] = [
  ...evaluateTools,
  ...navigationTools,
  ...observationTools,
  ...interactionTools,
  ...dialogTools,
  ...sessionTools,
  ...monitoringTools,
  ...devModeTools,
];

export * from "./types.js";
