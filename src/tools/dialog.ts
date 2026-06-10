import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CharlotteError, CharlotteErrorCode } from "../types/errors.js";
import { logger } from "../utils/logger.js";
import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDependencies } from "./tool-helpers.js";
import {
  ensureReady,
  renderAfterAction,
  formatPageResponse,
  handleToolError,
} from "./tool-helpers.js";

export function registerDialogTools(
  server: McpServer,
  deps: ToolDependencies,
): Record<string, RegisteredTool> {
  const tools: Record<string, RegisteredTool> = {};

  // ─── charlotte_dialog ───
  tools["charlotte_dialog"] = server.registerTool(
    "charlotte_dialog",
    {
      description:
        "Handle a pending JavaScript dialog (alert, confirm, prompt, beforeunload). Accept or dismiss the dialog. Returns page representation after the dialog is resolved.",
      inputSchema: {
        accept: z.boolean().describe("true to accept/OK the dialog, false to dismiss/Cancel"),
        prompt_text: z
          .string()
          .optional()
          .describe(
            'Text to enter for "prompt" dialogs before accepting. Ignored for other dialog types.',
          ),
      },
    },
    async ({ accept, prompt_text }) => {
      try {
        await ensureReady(deps);

        const pendingDialog = deps.pageManager.getPendingDialog();
        const pendingDialogInfo = deps.pageManager.getPendingDialogInfo();

        if (!pendingDialog || !pendingDialogInfo) {
          throw new CharlotteError(
            CharlotteErrorCode.SESSION_ERROR,
            "No pending dialog to handle.",
            "Call charlotte_observe to check page state. Dialogs appear as pending_dialog in the response.",
          );
        }

        // Capture dialog info before clearing for the response metadata
        const dialogHandled = {
          type: pendingDialogInfo.type,
          message: pendingDialogInfo.message,
          action: accept ? "accepted" : "dismissed",
        };

        logger.info("Handling dialog", {
          type: pendingDialogInfo.type,
          accept,
          prompt_text,
        });

        // Accept or dismiss the dialog
        if (accept) {
          await pendingDialog.accept(prompt_text);
        } else {
          await pendingDialog.dismiss();
        }

        // Clear the pending dialog state
        deps.pageManager.clearPendingDialog();

        // Brief settle for page to process dialog result
        await new Promise((resolve) => setTimeout(resolve, 50));

        const representation = await renderAfterAction(deps);

        // Route through formatPageResponse so the page payload is stripped and
        // size-capped like every other tool, with dialog_handled merged in as a
        // top-level key (previously the page was nested under a unique `page`
        // key, drifting from the rest of the API) (#204).
        return formatPageResponse(representation, {
          extra: { dialog_handled: dialogHandled },
          maxResponseBytes: deps.config.limits.maxResponseBytes,
        });
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );

  return tools;
}
