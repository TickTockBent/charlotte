import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import { BrowserManager } from "../../src/browser/browser-manager.js";
import { PageManager } from "../../src/browser/page-manager.js";
import { CDPSessionManager } from "../../src/browser/cdp-session.js";
import { RendererPipeline } from "../../src/renderer/renderer-pipeline.js";
import { ElementIdGenerator } from "../../src/renderer/element-id-generator.js";
import { SnapshotStore } from "../../src/state/snapshot-store.js";
import { ArtifactStore } from "../../src/state/artifact-store.js";
import { createDefaultConfig } from "../../src/types/config.js";
import type { CharlotteConfig } from "../../src/types/config.js";
import type { ToolDependencies } from "../../src/tools/tool-helpers.js";
import {
  renderActivePage,
  renderAfterAction,
  resolveElement,
} from "../../src/tools/tool-helpers.js";
import { waitForPossibleNavigation } from "../../src/tools/interaction.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";

const DIALOG_FIXTURE = `file://${path.resolve(import.meta.dirname, "../fixtures/pages/dialog.html")}`;

describe("Dialog integration", () => {
  let browserManager: BrowserManager;
  let config: CharlotteConfig;
  let pageManager: PageManager;
  let cdpSessionManager: CDPSessionManager;
  let elementIdGenerator: ElementIdGenerator;
  let rendererPipeline: RendererPipeline;
  let deps: ToolDependencies;

  beforeAll(async () => {
    browserManager = new BrowserManager();
    await browserManager.launch();
    config = createDefaultConfig();
    pageManager = new PageManager(config);
    await pageManager.openTab(browserManager);
    cdpSessionManager = new CDPSessionManager();
    elementIdGenerator = new ElementIdGenerator();
    rendererPipeline = new RendererPipeline(cdpSessionManager, elementIdGenerator);
    const artifactStore = new ArtifactStore(
      path.join(os.tmpdir(), "charlotte-dialog-test-artifacts"),
    );
    await artifactStore.initialize();
    deps = {
      browserManager,
      pageManager,
      rendererPipeline,
      elementIdGenerator,
      snapshotStore: new SnapshotStore(config.snapshotDepth),
      artifactStore,
      config,
    };
  });

  afterAll(async () => {
    await browserManager.close();
  });

  /**
   * Helper: dismiss any pending dialog and clear state, then navigate fresh.
   * Handles the case where a previous test left a beforeunload handler registered.
   */
  async function cleanNavigate(): Promise<void> {
    // Dismiss any pending dialog from a previous test
    const rawDialog = pageManager.getPendingDialog();
    if (rawDialog) {
      await rawDialog.accept();
      pageManager.clearPendingDialog();
    }

    const page = pageManager.getActivePage();

    // Remove any beforeunload handler before navigating to avoid new dialogs
    // (page.evaluate works here because we already dismissed any blocking dialog)
    try {
      await page.evaluate(() => {
        window.onbeforeunload = null;
      });
    } catch {
      // If evaluate fails, try navigating anyway
    }

    config.dialogAutoDismiss = "none";
    await page.goto(DIALOG_FIXTURE, { waitUntil: "load" });
    pageManager.clearPendingDialog();
  }

  /**
   * Helper: get the text content of the #result div
   */
  async function getResultText(): Promise<string> {
    const page = pageManager.getActivePage();
    return page.evaluate(() => {
      return document.getElementById("result")?.textContent ?? "";
    });
  }

  describe("dialog capture and handling", () => {
    beforeEach(async () => {
      await cleanNavigate();
    });

    it("captures and accepts an alert dialog", async () => {
      const page = pageManager.getActivePage();

      // Click triggers alert — don't await as it blocks until dialog handled
      const clickPromise = page.click("#alert-btn");
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Dialog should be captured
      const dialogInfo = pageManager.getPendingDialogInfo();
      expect(dialogInfo).not.toBeNull();
      expect(dialogInfo!.type).toBe("alert");
      expect(dialogInfo!.message).toBe("Hello from alert");
      expect(dialogInfo!.timestamp).toBeTruthy();

      // Accept the dialog
      const rawDialog = pageManager.getPendingDialog();
      expect(rawDialog).not.toBeNull();
      await rawDialog!.accept();
      pageManager.clearPendingDialog();
      await clickPromise;

      // Dialog state should be cleared
      expect(pageManager.getPendingDialogInfo()).toBeNull();
    });

    it("accepts a confirm dialog and returns true to page", async () => {
      const page = pageManager.getActivePage();

      const clickPromise = page.click("#confirm-btn");
      await new Promise((resolve) => setTimeout(resolve, 100));

      const dialogInfo = pageManager.getPendingDialogInfo();
      expect(dialogInfo).not.toBeNull();
      expect(dialogInfo!.type).toBe("confirm");
      expect(dialogInfo!.message).toBe("Do you agree?");

      const rawDialog = pageManager.getPendingDialog()!;
      await rawDialog.accept();
      pageManager.clearPendingDialog();
      await clickPromise;

      const resultText = await getResultText();
      expect(resultText).toBe("confirmed");
    });

    it("dismisses a confirm dialog and returns false to page", async () => {
      const page = pageManager.getActivePage();

      const clickPromise = page.click("#confirm-btn");
      await new Promise((resolve) => setTimeout(resolve, 100));

      const rawDialog = pageManager.getPendingDialog()!;
      await rawDialog.dismiss();
      pageManager.clearPendingDialog();
      await clickPromise;

      const resultText = await getResultText();
      expect(resultText).toBe("cancelled");
    });

    it("accepts a prompt dialog with custom text", async () => {
      const page = pageManager.getActivePage();

      const clickPromise = page.click("#prompt-btn");
      await new Promise((resolve) => setTimeout(resolve, 100));

      const dialogInfo = pageManager.getPendingDialogInfo();
      expect(dialogInfo).not.toBeNull();
      expect(dialogInfo!.type).toBe("prompt");
      expect(dialogInfo!.message).toBe("Enter name");

      const rawDialog = pageManager.getPendingDialog()!;
      await rawDialog.accept("Custom Name");
      pageManager.clearPendingDialog();
      await clickPromise;

      const resultText = await getResultText();
      expect(resultText).toBe("Custom Name");
    });

    it("captures default_value for prompt dialogs", async () => {
      const page = pageManager.getActivePage();

      const clickPromise = page.click("#prompt-btn");
      await new Promise((resolve) => setTimeout(resolve, 100));

      const dialogInfo = pageManager.getPendingDialogInfo();
      expect(dialogInfo).not.toBeNull();
      expect(dialogInfo!.default_value).toBe("default-name");

      const rawDialog = pageManager.getPendingDialog()!;
      await rawDialog.accept();
      pageManager.clearPendingDialog();
      await clickPromise;
    });

    it("dismisses a prompt dialog and returns null to page", async () => {
      const page = pageManager.getActivePage();

      const clickPromise = page.click("#prompt-btn");
      await new Promise((resolve) => setTimeout(resolve, 100));

      const rawDialog = pageManager.getPendingDialog()!;
      await rawDialog.dismiss();
      pageManager.clearPendingDialog();
      await clickPromise;

      const resultText = await getResultText();
      expect(resultText).toBe("null");
    });
  });

  describe("surfacing in responses", () => {
    beforeEach(async () => {
      await cleanNavigate();
    });

    it("pending_dialog appears in renderActivePage response when dialog is blocking", async () => {
      const page = pageManager.getActivePage();

      const clickPromise = page.click("#alert-btn");
      await new Promise((resolve) => setTimeout(resolve, 100));

      // renderActivePage returns a stub with pending_dialog when dialog is blocking
      const representation = await renderActivePage(deps, { source: "action" });
      expect(representation.pending_dialog).toBeDefined();
      expect(representation.pending_dialog!.type).toBe("alert");
      expect(representation.pending_dialog!.message).toBe("Hello from alert");
      // Stub representation has placeholder title
      expect(representation.title).toBe("(dialog blocking)");

      // Clean up
      const rawDialog = pageManager.getPendingDialog()!;
      await rawDialog.accept();
      pageManager.clearPendingDialog();
      await clickPromise;
    });

    it("no pending_dialog field when no dialog is active", async () => {
      const representation = await renderActivePage(deps, { source: "action" });
      expect(representation.pending_dialog).toBeUndefined();
    });
  });

  describe("auto-dismiss", () => {
    beforeEach(async () => {
      await cleanNavigate();
    });

    it("accept_alerts auto-accepts alert, still queues confirm", async () => {
      config.dialogAutoDismiss = "accept_alerts";
      const page = pageManager.getActivePage();

      // Alert should be auto-accepted (no blocking)
      await page.click("#alert-btn");
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(pageManager.getPendingDialogInfo()).toBeNull();

      // Confirm should be queued
      const clickPromise = page.click("#confirm-btn");
      await new Promise((resolve) => setTimeout(resolve, 100));
      const dialogInfo = pageManager.getPendingDialogInfo();
      expect(dialogInfo).not.toBeNull();
      expect(dialogInfo!.type).toBe("confirm");

      // Clean up
      const rawDialog = pageManager.getPendingDialog()!;
      await rawDialog.accept();
      pageManager.clearPendingDialog();
      await clickPromise;
    });

    it("accept_all auto-accepts confirm", async () => {
      config.dialogAutoDismiss = "accept_all";
      const page = pageManager.getActivePage();

      // Confirm should be auto-accepted
      await page.click("#confirm-btn");
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(pageManager.getPendingDialogInfo()).toBeNull();

      const resultText = await getResultText();
      expect(resultText).toBe("confirmed");
    });

    it("dismiss_all auto-dismisses confirm", async () => {
      config.dialogAutoDismiss = "dismiss_all";
      const page = pageManager.getActivePage();

      // Confirm should be auto-dismissed
      await page.click("#confirm-btn");
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(pageManager.getPendingDialogInfo()).toBeNull();

      const resultText = await getResultText();
      expect(resultText).toBe("cancelled");
    });
  });

  describe("beforeunload", () => {
    beforeEach(async () => {
      await cleanNavigate();
    });

    it("beforeunload dialog fires on navigation, accept allows navigation", async () => {
      const page = pageManager.getActivePage();

      // Register beforeunload handler
      await page.click("#beforeunload-btn");
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(await getResultText()).toBe("beforeunload registered");

      // Attempt navigation — triggers beforeunload dialog
      const navPromise = page.goto("about:blank", { waitUntil: "load" });
      await new Promise((resolve) => setTimeout(resolve, 200));

      const dialogInfo = pageManager.getPendingDialogInfo();
      expect(dialogInfo).not.toBeNull();
      expect(dialogInfo!.type).toBe("beforeunload");

      // Accept — allows navigation to proceed
      const rawDialog = pageManager.getPendingDialog()!;
      await rawDialog.accept();
      pageManager.clearPendingDialog();
      await navPromise;

      expect(page.url()).toBe("about:blank");
    });

    it("beforeunload dialog fires on navigation, dismiss cancels navigation", async () => {
      const page = pageManager.getActivePage();
      const originalUrl = page.url();

      // Register beforeunload handler
      await page.click("#beforeunload-btn");
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Attempt navigation — triggers beforeunload dialog
      const navPromise = page.goto("about:blank", { waitUntil: "load" }).catch(() => {
        // Navigation was cancelled by beforeunload dismiss — expected
      });
      await new Promise((resolve) => setTimeout(resolve, 200));

      const dialogInfo = pageManager.getPendingDialogInfo();
      expect(dialogInfo).not.toBeNull();
      expect(dialogInfo!.type).toBe("beforeunload");

      // Dismiss — cancels navigation
      const rawDialog = pageManager.getPendingDialog()!;
      await rawDialog.dismiss();
      pageManager.clearPendingDialog();
      await navPromise;

      // URL should be unchanged (navigation was cancelled)
      expect(page.url()).toBe(originalUrl);
      // Dialog state should be cleared
      expect(pageManager.getPendingDialogInfo()).toBeNull();
    });
  });

  describe("error cases", () => {
    beforeEach(async () => {
      await cleanNavigate();
    });

    it("getPendingDialog returns null when no dialog is pending", () => {
      expect(pageManager.getPendingDialog()).toBeNull();
      expect(pageManager.getPendingDialogInfo()).toBeNull();
    });
  });

  // ─── #34: Test charlotte:dialog tool response through MCP ───
  describe("dialog tool response via MCP (#34)", () => {
    let mcpClient: Client;
    let closeTransport: () => Promise<void>;

    beforeAll(async () => {
      const { server } = createServer(
        {
          browserManager: deps.browserManager,
          pageManager: deps.pageManager,
          rendererPipeline: deps.rendererPipeline,
          elementIdGenerator: deps.elementIdGenerator,
          snapshotStore: deps.snapshotStore,
          artifactStore: deps.artifactStore,
          config: deps.config,
        },
        { profile: "full" },
      );

      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);

      mcpClient = new Client({ name: "dialog-test", version: "1.0.0" });
      await mcpClient.connect(clientTransport);

      closeTransport = async () => {
        await mcpClient.close();
        await server.close();
      };
    });

    afterAll(async () => {
      await closeTransport();
    });

    beforeEach(async () => {
      await cleanNavigate();
    });

    it("charlotte:dialog accept returns dialog_handled with correct type, message, and action", async () => {
      const page = pageManager.getActivePage();

      // Trigger confirm dialog
      const clickPromise = page.click("#confirm-btn");
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Call charlotte:dialog through MCP
      const result = await mcpClient.callTool({
        name: "charlotte:dialog",
        arguments: { accept: true },
      });

      await clickPromise;

      // Parse the actual tool response
      expect(result.content).toHaveLength(1);
      const responsePayload = JSON.parse(
        (result.content as Array<{ type: string; text: string }>)[0].text,
      );

      // Validate dialog_handled metadata
      expect(responsePayload.dialog_handled).toBeDefined();
      expect(responsePayload.dialog_handled.type).toBe("confirm");
      expect(responsePayload.dialog_handled.message).toBe("Do you agree?");
      expect(responsePayload.dialog_handled.action).toBe("accepted");

      // Validate page representation is included
      expect(responsePayload.page).toBeDefined();
      expect(responsePayload.page.url).toBeTruthy();
    });

    it("charlotte:dialog dismiss returns action 'dismissed'", async () => {
      const page = pageManager.getActivePage();

      const clickPromise = page.click("#confirm-btn");
      await new Promise((resolve) => setTimeout(resolve, 200));

      const result = await mcpClient.callTool({
        name: "charlotte:dialog",
        arguments: { accept: false },
      });

      await clickPromise;

      const responsePayload = JSON.parse(
        (result.content as Array<{ type: string; text: string }>)[0].text,
      );

      expect(responsePayload.dialog_handled.action).toBe("dismissed");
      expect(responsePayload.dialog_handled.type).toBe("confirm");
    });

    it("charlotte:dialog with prompt_text includes text in accept", async () => {
      const page = pageManager.getActivePage();

      const clickPromise = page.click("#prompt-btn");
      await new Promise((resolve) => setTimeout(resolve, 200));

      const result = await mcpClient.callTool({
        name: "charlotte:dialog",
        arguments: { accept: true, prompt_text: "Test Name" },
      });

      await clickPromise;

      const responsePayload = JSON.parse(
        (result.content as Array<{ type: string; text: string }>)[0].text,
      );

      expect(responsePayload.dialog_handled.type).toBe("prompt");
      expect(responsePayload.dialog_handled.message).toBe("Enter name");
      expect(responsePayload.dialog_handled.action).toBe("accepted");

      // Verify the prompt text was passed through to the page
      const resultText = await getResultText();
      expect(resultText).toBe("Test Name");
    });

    it("charlotte:dialog returns error when no dialog is pending", async () => {
      const result = await mcpClient.callTool({
        name: "charlotte:dialog",
        arguments: { accept: true },
      });

      expect(result.isError).toBe(true);
      const errorPayload = JSON.parse(
        (result.content as Array<{ type: string; text: string }>)[0].text,
      );
      expect(errorPayload.error.code).toBe("SESSION_ERROR");
      expect(errorPayload.error.message).toBe("No pending dialog to handle.");
    });
  });

  // ─── #30: End-to-end dialog-aware action racing ───
  describe("dialog-aware action racing end-to-end (#30)", () => {
    beforeEach(async () => {
      await cleanNavigate();
    });

    it("waitForPossibleNavigation returns early when click triggers alert", async () => {
      const page = pageManager.getActivePage();

      // Render to get element IDs, then resolve the alert button
      await renderActivePage(deps, { detail: "summary" });
      const alertButton = deps.elementIdGenerator.findSimilar("btn-", []);

      // Use waitForPossibleNavigation with a real click action (same as charlotte:click)
      const timeoutPromise = new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), 5000),
      );

      const actionPromise = (async () => {
        await waitForPossibleNavigation(page, () => page.click("#alert-btn"));
        return "completed" as const;
      })();

      const raceResult = await Promise.race([actionPromise, timeoutPromise]);
      expect(raceResult).toBe("completed");

      // renderAfterAction should return stub with pending_dialog
      const representation = await renderAfterAction(deps);
      expect(representation.pending_dialog).toBeDefined();
      expect(representation.pending_dialog!.type).toBe("alert");
      expect(representation.pending_dialog!.message).toBe("Hello from alert");
      expect(representation.title).toBe("(dialog blocking)");

      // Clean up
      const rawDialog = pageManager.getPendingDialog();
      if (rawDialog) {
        await rawDialog.accept();
        pageManager.clearPendingDialog();
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it("waitForPossibleNavigation returns early when click triggers confirm", async () => {
      const page = pageManager.getActivePage();

      const actionPromise = (async () => {
        await waitForPossibleNavigation(page, () => page.click("#confirm-btn"));
        return "completed" as const;
      })();

      const timeoutPromise = new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), 5000),
      );

      const raceResult = await Promise.race([actionPromise, timeoutPromise]);
      expect(raceResult).toBe("completed");

      // Dialog should be pending
      const dialogInfo = pageManager.getPendingDialogInfo();
      expect(dialogInfo).not.toBeNull();
      expect(dialogInfo!.type).toBe("confirm");

      // Clean up
      const rawDialog = pageManager.getPendingDialog()!;
      await rawDialog.accept();
      pageManager.clearPendingDialog();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it("full click→dialog→render path produces correct response", async () => {
      // This tests the exact sequence charlotte:click uses:
      // resolveElement → waitForPossibleNavigation(click) → renderAfterAction
      const representation = await renderActivePage(deps, { detail: "summary" });
      const alertButton = representation.interactive.find(
        (el) => el.label === "Alert",
      );
      expect(alertButton).toBeDefined();

      const { page, backendNodeId } = await resolveElement(deps, alertButton!.id);

      // Execute the click through waitForPossibleNavigation
      await waitForPossibleNavigation(page, async () => {
        const cdpSession = await page.createCDPSession();
        try {
          await cdpSession.send("DOM.scrollIntoViewIfNeeded", { backendNodeId });
          const { model } = await cdpSession.send("DOM.getBoxModel", { backendNodeId });
          const contentQuad = model.content;
          const centerX = (contentQuad[0] + contentQuad[2] + contentQuad[4] + contentQuad[6]) / 4;
          const centerY = (contentQuad[1] + contentQuad[3] + contentQuad[5] + contentQuad[7]) / 4;
          await page.mouse.click(centerX, centerY);
        } finally {
          await cdpSession.detach();
        }
      });

      // renderAfterAction — the same call charlotte:click makes
      const afterAction = await renderAfterAction(deps);
      expect(afterAction.pending_dialog).toBeDefined();
      expect(afterAction.pending_dialog!.type).toBe("alert");

      // Clean up
      const rawDialog = pageManager.getPendingDialog();
      if (rawDialog) {
        await rawDialog.accept();
        pageManager.clearPendingDialog();
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  });

  // ─── #33: Sequential/rapid-fire dialogs ───
  describe("sequential dialogs (#33)", () => {
    beforeEach(async () => {
      await cleanNavigate();
    });

    it("handles two confirm dialogs in sequence", async () => {
      const page = pageManager.getActivePage();

      // Click triggers: confirm('First question?') then confirm('Second question?')
      const clickPromise = page.click("#double-confirm");
      await new Promise((resolve) => setTimeout(resolve, 200));

      // First dialog should be captured
      const firstDialogInfo = pageManager.getPendingDialogInfo();
      expect(firstDialogInfo).not.toBeNull();
      expect(firstDialogInfo!.type).toBe("confirm");
      expect(firstDialogInfo!.message).toBe("First question?");

      // Accept the first dialog
      const firstDialog = pageManager.getPendingDialog()!;
      await firstDialog.accept();
      pageManager.clearPendingDialog();

      // Wait for the second dialog to appear (JS continues synchronously after first is handled)
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Second dialog should now be captured
      const secondDialogInfo = pageManager.getPendingDialogInfo();
      expect(secondDialogInfo).not.toBeNull();
      expect(secondDialogInfo!.type).toBe("confirm");
      expect(secondDialogInfo!.message).toBe("Second question?");

      // Accept the second dialog
      const secondDialog = pageManager.getPendingDialog()!;
      await secondDialog.accept();
      pageManager.clearPendingDialog();
      await clickPromise;

      // Verify both dialogs were processed correctly
      const resultText = await getResultText();
      expect(resultText).toBe("first:yes,second:yes");
    });

    it("handles mixed accept/dismiss in sequential dialogs", async () => {
      const page = pageManager.getActivePage();

      const clickPromise = page.click("#double-confirm");
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Dismiss the first dialog
      const firstDialog = pageManager.getPendingDialog()!;
      await firstDialog.dismiss();
      pageManager.clearPendingDialog();

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Accept the second dialog
      const secondDialog = pageManager.getPendingDialog()!;
      expect(secondDialog).not.toBeNull();
      await secondDialog.accept();
      pageManager.clearPendingDialog();
      await clickPromise;

      const resultText = await getResultText();
      expect(resultText).toBe("first:no,second:yes");
    });

    it("clearPendingDialog does not lose a subsequent dialog", async () => {
      const page = pageManager.getActivePage();

      // Trigger double confirm — two synchronous dialogs
      const clickPromise = page.click("#double-confirm");
      await new Promise((resolve) => setTimeout(resolve, 200));

      // First dialog present
      expect(pageManager.getPendingDialogInfo()!.message).toBe("First question?");

      // Accept and clear
      await pageManager.getPendingDialog()!.accept();
      pageManager.clearPendingDialog();

      // After clearing first, second should arrive
      await new Promise((resolve) => setTimeout(resolve, 200));
      const secondInfo = pageManager.getPendingDialogInfo();
      expect(secondInfo).not.toBeNull();
      expect(secondInfo!.message).toBe("Second question?");

      // Clean up
      await pageManager.getPendingDialog()!.accept();
      pageManager.clearPendingDialog();
      await clickPromise;
    });

    it("dialog state is clean after handling all sequential dialogs", async () => {
      const page = pageManager.getActivePage();

      const clickPromise = page.click("#double-confirm");
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Handle first
      await pageManager.getPendingDialog()!.accept();
      pageManager.clearPendingDialog();
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Handle second
      await pageManager.getPendingDialog()!.accept();
      pageManager.clearPendingDialog();
      await clickPromise;

      // State should be fully clean
      expect(pageManager.getPendingDialog()).toBeNull();
      expect(pageManager.getPendingDialogInfo()).toBeNull();

      // renderActivePage should produce a normal response (no stub)
      const representation = await renderActivePage(deps, { source: "action" });
      expect(representation.pending_dialog).toBeUndefined();
      expect(representation.title).not.toBe("(dialog blocking)");
    });
  });
});
