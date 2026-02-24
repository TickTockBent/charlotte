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
} from "../../src/tools/tool-helpers.js";

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

  describe("response metadata", () => {
    beforeEach(async () => {
      await cleanNavigate();
    });

    it("dialog_handled metadata is available after handling", async () => {
      const page = pageManager.getActivePage();

      const clickPromise = page.click("#confirm-btn");
      await new Promise((resolve) => setTimeout(resolve, 100));

      const dialogInfo = pageManager.getPendingDialogInfo();
      expect(dialogInfo).not.toBeNull();

      // Capture what dialog_handled should contain
      const expectedHandled = {
        type: dialogInfo!.type,
        message: dialogInfo!.message,
        action: "accepted",
      };

      const rawDialog = pageManager.getPendingDialog()!;
      await rawDialog.accept();
      pageManager.clearPendingDialog();
      await clickPromise;

      expect(expectedHandled.type).toBe("confirm");
      expect(expectedHandled.message).toBe("Do you agree?");
      expect(expectedHandled.action).toBe("accepted");
    });
  });

  describe("dialog-aware action racing", () => {
    beforeEach(async () => {
      await cleanNavigate();
    });

    it("click that triggers alert does not hang and surfaces pending_dialog", async () => {
      const page = pageManager.getActivePage();

      // Use a timed race to ensure we don't hang.
      // The click + render should complete quickly because the dialog-aware
      // racing detects the dialog and returns early.
      const timeoutPromise = new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), 5000),
      );

      const actionPromise = (async () => {
        // Simulate what the click tool does: action + render
        const clickAction = page.click("#alert-btn");
        // Race click against dialog detection
        const dialogAppeared = new Promise<void>((resolve) => {
          const handler = () => {
            page.off("dialog", handler);
            resolve();
          };
          page.on("dialog", handler);
        });

        await Promise.race([
          clickAction.then(() => "click" as const),
          dialogAppeared.then(() => "dialog" as const),
        ]);

        // Suppress potential rejection from the click promise
        clickAction.catch(() => {});

        // Now render — should return stub with pending_dialog
        const representation = await renderActivePage(deps, { source: "action" });
        return representation;
      })();

      const result = await Promise.race([actionPromise, timeoutPromise]);

      expect(result).not.toBe("timeout");
      if (result !== "timeout") {
        expect(result.pending_dialog).toBeDefined();
        expect(result.pending_dialog!.type).toBe("alert");
      }

      // Clean up: accept the dialog
      const rawDialog = pageManager.getPendingDialog();
      if (rawDialog) {
        await rawDialog.accept();
        pageManager.clearPendingDialog();
      }
      // Let the original click promise settle
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  });
});
