import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
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
import { pollUntil } from "../helpers/poll.js";
import type { PendingDialog } from "../../src/types/page-representation.js";

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
    browserManager = new BrowserManager(undefined, { noSandbox: true });
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
      cdpSessionManager,
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
   * In-flight click/navigation promises that block on a dialog. A test triggers
   * a dialog by clicking; the click promise does not settle until the dialog is
   * handled. If a test's assertion throws before it awaits that promise, the
   * promise leaks into the next test — Puppeteer later tries to resolve a node
   * against a page that has since navigated, producing the ProtocolError /
   * "expected null not to be null" flake in #166. Tracking every triggering
   * promise here and draining them in afterEach guarantees no handle outlives
   * its test.
   */
  let inFlightDialogPromises: Promise<unknown>[] = [];

  /**
   * Click a selector that triggers a (possibly blocking) dialog. The returned
   * promise is registered so afterEach can drain it even if the test throws.
   */
  function triggerDialog(selector: string): Promise<unknown> {
    const page = pageManager.getActivePage();
    const promise = page.click(selector).catch(() => {
      // The triggering click may reject if the page navigates or the dialog
      // tears down the execution context — that is expected on teardown.
    });
    inFlightDialogPromises.push(promise);
    return promise;
  }

  /** Poll until a pending dialog is captured, optionally of a specific type. */
  async function waitForDialog(type?: PendingDialog["type"]): Promise<PendingDialog> {
    return pollUntil(
      () => {
        const info = pageManager.getPendingDialogInfo();
        if (!info) return null;
        if (type && info.type !== type) return null;
        return info;
      },
      { message: `dialog${type ? ` of type ${type}` : ""} did not appear` },
    );
  }

  /** Poll until a pending dialog with the given message is captured. */
  async function waitForDialogMessage(message: string): Promise<PendingDialog> {
    return pollUntil(
      () => {
        const info = pageManager.getPendingDialogInfo();
        return info && info.message === message ? info : null;
      },
      { message: `dialog with message "${message}" did not appear` },
    );
  }

  /** Poll until no dialog is pending. */
  async function waitForNoDialog(): Promise<void> {
    await pollUntil(() => pageManager.getPendingDialogInfo() === null, {
      message: "pending dialog was not cleared",
    });
  }

  /**
   * Drain every in-flight triggering promise: dismiss any still-pending dialog
   * (which unblocks the click), then await all tracked promises so no handle
   * survives into the next test.
   */
  async function drainInFlightDialogs(): Promise<void> {
    // Repeatedly dismiss until no dialog is pending — sequential dialogs may
    // queue a second one once the first is handled.
    for (let guard = 0; guard < 10; guard++) {
      const rawDialog = pageManager.getPendingDialog();
      if (!rawDialog) break;
      await rawDialog.accept().catch(() => {});
      pageManager.clearPendingDialog();
      // Give a queued follow-up dialog a chance to surface before re-checking.
      await new Promise((resolve) => setImmediate(resolve));
    }
    const pending = inFlightDialogPromises;
    inFlightDialogPromises = [];
    await Promise.allSettled(pending);
  }

  /**
   * Helper: dismiss any pending dialog and clear state, then navigate fresh.
   * Handles the case where a previous test left a beforeunload handler registered.
   */
  async function cleanNavigate(): Promise<void> {
    // Drain any leaked in-flight dialog promises from a prior test first.
    await drainInFlightDialogs();

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

  // Drain leaked dialog promises after every test (incl. ones that threw) so a
  // stale ElementHandle never resolves against the next test's page (#166).
  afterEach(async () => {
    await drainInFlightDialogs();
  });

  describe("dialog capture and handling", () => {
    beforeEach(async () => {
      await cleanNavigate();
    });

    it("captures and accepts an alert dialog", async () => {
      // Click triggers alert — it blocks until the dialog is handled.
      triggerDialog("#alert-btn");

      // Dialog should be captured
      const dialogInfo = await waitForDialog("alert");
      expect(dialogInfo.message).toBe("Hello from alert");
      expect(dialogInfo.timestamp).toBeTruthy();

      // Accept the dialog
      const rawDialog = pageManager.getPendingDialog();
      expect(rawDialog).not.toBeNull();
      await rawDialog!.accept();
      pageManager.clearPendingDialog();

      // Dialog state should be cleared
      await waitForNoDialog();
    });

    it("accepts a confirm dialog and returns true to page", async () => {
      triggerDialog("#confirm-btn");

      const dialogInfo = await waitForDialog("confirm");
      expect(dialogInfo.message).toBe("Do you agree?");

      const rawDialog = pageManager.getPendingDialog()!;
      await rawDialog.accept();
      pageManager.clearPendingDialog();

      await pollUntil(async () => (await getResultText()) === "confirmed", {
        message: 'result text never became "confirmed"',
      });
    });

    it("dismisses a confirm dialog and returns false to page", async () => {
      triggerDialog("#confirm-btn");

      await waitForDialog("confirm");
      const rawDialog = pageManager.getPendingDialog()!;
      await rawDialog.dismiss();
      pageManager.clearPendingDialog();

      await pollUntil(async () => (await getResultText()) === "cancelled", {
        message: 'result text never became "cancelled"',
      });
    });

    it("accepts a prompt dialog with custom text", async () => {
      triggerDialog("#prompt-btn");

      const dialogInfo = await waitForDialog("prompt");
      expect(dialogInfo.message).toBe("Enter name");

      const rawDialog = pageManager.getPendingDialog()!;
      await rawDialog.accept("Custom Name");
      pageManager.clearPendingDialog();

      await pollUntil(async () => (await getResultText()) === "Custom Name", {
        message: 'result text never became "Custom Name"',
      });
    });

    it("captures default_value for prompt dialogs", async () => {
      triggerDialog("#prompt-btn");

      const dialogInfo = await waitForDialog("prompt");
      expect(dialogInfo.default_value).toBe("default-name");

      const rawDialog = pageManager.getPendingDialog()!;
      await rawDialog.accept();
      pageManager.clearPendingDialog();
    });

    it("dismisses a prompt dialog and returns null to page", async () => {
      triggerDialog("#prompt-btn");

      await waitForDialog("prompt");
      const rawDialog = pageManager.getPendingDialog()!;
      await rawDialog.dismiss();
      pageManager.clearPendingDialog();

      await pollUntil(async () => (await getResultText()) === "null", {
        message: 'result text never became "null"',
      });
    });
  });

  describe("surfacing in responses", () => {
    beforeEach(async () => {
      await cleanNavigate();
    });

    it("pending_dialog appears in renderActivePage response when dialog is blocking", async () => {
      triggerDialog("#alert-btn");
      await waitForDialog("alert");

      // renderActivePage returns a stub with pending_dialog when dialog is blocking
      const representation = await renderActivePage(deps, { source: "action" });
      expect(representation.pending_dialog).toBeDefined();
      expect(representation.pending_dialog!.type).toBe("alert");
      expect(representation.pending_dialog!.message).toBe("Hello from alert");
      // Stub representation has placeholder title
      expect(representation.title).toBe("(dialog blocking)");
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

      // Alert should be auto-accepted (click resolves once handled, no blocking)
      await page.click("#alert-btn");
      expect(pageManager.getPendingDialogInfo()).toBeNull();

      // Confirm should be queued
      triggerDialog("#confirm-btn");
      const dialogInfo = await waitForDialog("confirm");
      expect(dialogInfo.type).toBe("confirm");

      // Clean up
      const rawDialog = pageManager.getPendingDialog()!;
      await rawDialog.accept();
      pageManager.clearPendingDialog();
    });

    it("accept_all auto-accepts confirm", async () => {
      config.dialogAutoDismiss = "accept_all";
      const page = pageManager.getActivePage();

      // Confirm should be auto-accepted (click resolves once handled)
      await page.click("#confirm-btn");
      expect(pageManager.getPendingDialogInfo()).toBeNull();

      await pollUntil(async () => (await getResultText()) === "confirmed", {
        message: 'result text never became "confirmed"',
      });
    });

    it("dismiss_all auto-dismisses confirm", async () => {
      config.dialogAutoDismiss = "dismiss_all";
      const page = pageManager.getActivePage();

      // Confirm should be auto-dismissed (click resolves once handled)
      await page.click("#confirm-btn");
      expect(pageManager.getPendingDialogInfo()).toBeNull();

      await pollUntil(async () => (await getResultText()) === "cancelled", {
        message: 'result text never became "cancelled"',
      });
    });
  });

  describe("beforeunload", () => {
    beforeEach(async () => {
      await cleanNavigate();
    });

    it("beforeunload dialog fires on navigation, accept allows navigation", async () => {
      const page = pageManager.getActivePage();

      // Register beforeunload handler (click resolves normally — no dialog yet)
      await page.click("#beforeunload-btn");
      await pollUntil(async () => (await getResultText()) === "beforeunload registered", {
        message: "beforeunload handler was not registered",
      });

      // Attempt navigation — triggers beforeunload dialog. Track the promise so
      // it cannot leak into the next test.
      const navPromise = page.goto("about:blank", { waitUntil: "load" }).catch(() => {});
      inFlightDialogPromises.push(navPromise);

      const dialogInfo = await waitForDialog("beforeunload");
      expect(dialogInfo.type).toBe("beforeunload");

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
      await pollUntil(async () => (await getResultText()) === "beforeunload registered", {
        message: "beforeunload handler was not registered",
      });

      // Attempt navigation — triggers beforeunload dialog
      const navPromise = page.goto("about:blank", { waitUntil: "load" }).catch(() => {
        // Navigation was cancelled by beforeunload dismiss — expected
      });
      inFlightDialogPromises.push(navPromise);

      const dialogInfo = await waitForDialog("beforeunload");
      expect(dialogInfo.type).toBe("beforeunload");

      // Dismiss — cancels navigation
      const rawDialog = pageManager.getPendingDialog()!;
      await rawDialog.dismiss();
      pageManager.clearPendingDialog();
      await navPromise;

      // URL should be unchanged (navigation was cancelled)
      expect(page.url()).toBe(originalUrl);
      // Dialog state should be cleared
      await waitForNoDialog();
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

  // ─── #34: Test charlotte_dialog tool response through MCP ───
  describe("dialog tool response via MCP (#34)", () => {
    let mcpClient: Client;
    let closeTransport: () => Promise<void>;

    beforeAll(async () => {
      const { server } = createServer(
        {
          browserManager: deps.browserManager,
          pageManager: deps.pageManager,
          cdpSessionManager,
          rendererPipeline: deps.rendererPipeline,
          elementIdGenerator: deps.elementIdGenerator,
          snapshotStore: deps.snapshotStore,
          artifactStore: deps.artifactStore,
          config: deps.config,
        },
        { profile: "full" },
      );

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
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

    it("charlotte_dialog accept returns dialog_handled with correct type, message, and action", async () => {
      // Trigger confirm dialog and wait for it to be captured
      triggerDialog("#confirm-btn");
      await waitForDialog("confirm");

      // Call charlotte_dialog through MCP (handling it unblocks the click)
      const result = await mcpClient.callTool({
        name: "charlotte_dialog",
        arguments: { accept: true },
      });

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

      // Validate page representation is merged in at the top level (the page
      // payload is no longer nested under a `page` key — #204).
      expect(responsePayload.url).toBeTruthy();
    });

    it("charlotte_dialog dismiss returns action 'dismissed'", async () => {
      triggerDialog("#confirm-btn");
      await waitForDialog("confirm");

      const result = await mcpClient.callTool({
        name: "charlotte_dialog",
        arguments: { accept: false },
      });

      const responsePayload = JSON.parse(
        (result.content as Array<{ type: string; text: string }>)[0].text,
      );

      expect(responsePayload.dialog_handled.action).toBe("dismissed");
      expect(responsePayload.dialog_handled.type).toBe("confirm");
    });

    it("charlotte_dialog with prompt_text includes text in accept", async () => {
      triggerDialog("#prompt-btn");
      await waitForDialog("prompt");

      const result = await mcpClient.callTool({
        name: "charlotte_dialog",
        arguments: { accept: true, prompt_text: "Test Name" },
      });

      const responsePayload = JSON.parse(
        (result.content as Array<{ type: string; text: string }>)[0].text,
      );

      expect(responsePayload.dialog_handled.type).toBe("prompt");
      expect(responsePayload.dialog_handled.message).toBe("Enter name");
      expect(responsePayload.dialog_handled.action).toBe("accepted");

      // Verify the prompt text was passed through to the page
      await pollUntil(async () => (await getResultText()) === "Test Name", {
        message: 'result text never became "Test Name"',
      });
    });

    it("charlotte_dialog returns error when no dialog is pending", async () => {
      const result = await mcpClient.callTool({
        name: "charlotte_dialog",
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
      const _alertButton = deps.elementIdGenerator.findSimilar("btn-", []);

      // Use waitForPossibleNavigation with a real click action (same as charlotte_click)
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
      // afterEach drains the pending dialog.
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
      // afterEach drains the pending dialog.
    });

    it("full click→dialog→render path produces correct response", async () => {
      // This tests the exact sequence charlotte_click uses:
      // resolveElement → waitForPossibleNavigation(click) → renderAfterAction
      const representation = await renderActivePage(deps, { detail: "summary" });
      const alertButton = representation.interactive.find((el) => el.label === "Alert");
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

      // renderAfterAction — the same call charlotte_click makes
      const afterAction = await renderAfterAction(deps);
      expect(afterAction.pending_dialog).toBeDefined();
      expect(afterAction.pending_dialog!.type).toBe("alert");
      // afterEach drains the pending dialog.
    });
  });

  // ─── #33: Sequential/rapid-fire dialogs ───
  describe("sequential dialogs (#33)", () => {
    beforeEach(async () => {
      await cleanNavigate();
    });

    it("handles two confirm dialogs in sequence", async () => {
      // Click triggers: confirm('First question?') then confirm('Second question?')
      triggerDialog("#double-confirm");

      // First dialog should be captured
      const firstDialogInfo = await waitForDialogMessage("First question?");
      expect(firstDialogInfo.type).toBe("confirm");

      // Accept the first dialog
      const firstDialog = pageManager.getPendingDialog()!;
      await firstDialog.accept();
      pageManager.clearPendingDialog();

      // Second dialog should now be captured (JS continues after first is handled)
      const secondDialogInfo = await waitForDialogMessage("Second question?");
      expect(secondDialogInfo.type).toBe("confirm");

      // Accept the second dialog
      const secondDialog = pageManager.getPendingDialog()!;
      await secondDialog.accept();
      pageManager.clearPendingDialog();

      // Verify both dialogs were processed correctly
      await pollUntil(async () => (await getResultText()) === "first:yes,second:yes", {
        message: 'result text never became "first:yes,second:yes"',
      });
    });

    it("handles mixed accept/dismiss in sequential dialogs", async () => {
      triggerDialog("#double-confirm");

      // Dismiss the first dialog
      await waitForDialogMessage("First question?");
      const firstDialog = pageManager.getPendingDialog()!;
      await firstDialog.dismiss();
      pageManager.clearPendingDialog();

      // Accept the second dialog
      await waitForDialogMessage("Second question?");
      const secondDialog = pageManager.getPendingDialog()!;
      await secondDialog.accept();
      pageManager.clearPendingDialog();

      await pollUntil(async () => (await getResultText()) === "first:no,second:yes", {
        message: 'result text never became "first:no,second:yes"',
      });
    });

    it("clearPendingDialog does not lose a subsequent dialog", async () => {
      // Trigger double confirm — two synchronous dialogs
      triggerDialog("#double-confirm");

      // First dialog present
      await waitForDialogMessage("First question?");

      // Accept and clear
      await pageManager.getPendingDialog()!.accept();
      pageManager.clearPendingDialog();

      // After clearing first, second should arrive
      const secondInfo = await waitForDialogMessage("Second question?");
      expect(secondInfo.message).toBe("Second question?");

      // Clean up
      await pageManager.getPendingDialog()!.accept();
      pageManager.clearPendingDialog();
    });

    it("dialog state is clean after handling all sequential dialogs", async () => {
      triggerDialog("#double-confirm");

      // Handle first
      await waitForDialogMessage("First question?");
      await pageManager.getPendingDialog()!.accept();
      pageManager.clearPendingDialog();

      // Handle second
      await waitForDialogMessage("Second question?");
      await pageManager.getPendingDialog()!.accept();
      pageManager.clearPendingDialog();

      // State should be fully clean
      await waitForNoDialog();
      expect(pageManager.getPendingDialog()).toBeNull();
      expect(pageManager.getPendingDialogInfo()).toBeNull();

      // renderActivePage should produce a normal response (no stub)
      const representation = await renderActivePage(deps, { source: "action" });
      expect(representation.pending_dialog).toBeUndefined();
      expect(representation.title).not.toBe("(dialog blocking)");
    });
  });
});
