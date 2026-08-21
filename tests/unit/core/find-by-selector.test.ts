import { describe, it, expect, vi } from "vitest";
import type { Page } from "puppeteer";
import { findBySelector } from "../../../src/core/observation.js";
import { ElementIdGenerator } from "../../../src/renderer/element-id-generator.js";
import type { SessionContext } from "../../../src/core/types.js";

/**
 * Build a fake Puppeteer page whose CDP session returns two querySelectorAll
 * matches, where `DOM.describeNode` fails for the first node and succeeds for
 * the second. This mirrors a pseudo-element or otherwise undescribable node
 * sitting ahead of a real match (#220).
 */
function createPageWithFailingFirstMatch(): { page: Page; describeNodeCalls: number[] } {
  const describeNodeCalls: number[] = [];
  const cdpSession = {
    send: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      switch (method) {
        case "DOM.getDocument":
          return { root: { nodeId: 1 } };
        case "DOM.querySelectorAll":
          return { nodeIds: [10, 11] };
        case "DOM.describeNode": {
          const nodeId = params?.nodeId as number;
          describeNodeCalls.push(nodeId);
          if (nodeId === 10) {
            throw new Error("Could not find node with given id");
          }
          return { node: { backendNodeId: 211, nodeName: "BUTTON" } };
        }
        case "DOM.resolveNode":
          return { object: { objectId: "obj-211" } };
        case "Runtime.callFunctionOn":
          return { result: { value: "Second button" } };
        case "DOM.getBoxModel":
          return { model: { content: [0, 0, 10, 0, 10, 10, 0, 10] } };
        default:
          throw new Error(`Unexpected CDP method ${method}`);
      }
    }),
    detach: vi.fn(async () => {}),
  };
  const page = { createCDPSession: vi.fn(async () => cdpSession) } as unknown as Page;
  return { page, describeNodeCalls };
}

describe("findBySelector match-index bookkeeping (#220)", () => {
  it("records the raw querySelectorAll position even when an earlier match fails describeNode", async () => {
    const { page, describeNodeCalls } = createPageWithFailingFirstMatch();
    const elementIdGenerator = new ElementIdGenerator();
    const deps = { elementIdGenerator } as unknown as SessionContext;

    const results = await findBySelector(page, deps, "button");

    expect(describeNodeCalls).toEqual([10, 11]);
    expect(results).toHaveLength(1);
    expect(results[0].tag).toBe("button");
    expect(results[0].bounds).toEqual({ x: 0, y: 0, w: 10, h: 10 });

    const registration = elementIdGenerator.getDomQueryRegistration(results[0].id);
    expect(registration).not.toBeNull();
    // Re-resolution indexes nodeIds[matchIndex] directly, so the surviving
    // element must be registered at its raw position (1), not the count of
    // successful matches so far (0).
    expect(registration!.matchIndex).toBe(1);
    expect(registration!.backendDOMNodeId).toBe(211);
    expect(registration!.selector).toBe("button");
  });
});
