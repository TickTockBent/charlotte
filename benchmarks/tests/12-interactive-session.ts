/**
 * Test 12: Interactive Form Session
 *
 * Navigate to httpbin form, observe, find inputs, type into each,
 * re-observe after each interaction, and submit.
 * High interaction density (~13+ tool calls).
 * Uses only core tools (navigate, observe, find, type, submit) — works on all profiles.
 */

import { BenchmarkTest } from "../harness/test-runner.js";
import { BenchmarkMcpClient } from "../harness/mcp-client.js";

const TARGET_URL = "https://httpbin.org/forms/post";

export const interactiveSessionTest: BenchmarkTest = {
  name: "Interactive Session (form)",
  description:
    "Navigate to httpbin form, find and fill multiple inputs with re-observation after each, then submit. ~13+ tool calls.",
  successCriteria:
    "At least one input filled and form submitted or state observed after interactions.",
  supportedServers: ["Charlotte"],

  async run(client: BenchmarkMcpClient, serverName: string) {
    const responseText = (result: unknown): string => {
      const response = result as { content?: Array<{ text?: string }> };
      return response.content?.map((c) => c.text ?? "").join("\n") ?? JSON.stringify(result);
    };

    // 1. Navigate
    await client.callTool("charlotte:navigate", { url: TARGET_URL });

    // 2. Observe (summary) to understand page structure
    const observeResult = await client.callTool("charlotte:observe", {
      detail: "summary",
    });
    const observeText = responseText(observeResult.response);

    // 3. Find text inputs
    const findInputsResult = await client.callTool("charlotte:find", {
      type: "text_input",
    });
    const findText = responseText(findInputsResult.response);

    // Extract input IDs
    const inputIdMatches = findText.match(/inp-[a-f0-9]{4}/g) ?? [];
    const formIdMatches = observeText.match(/frm-[a-f0-9]{4}/g) ?? [];

    let filledCount = 0;
    const testValues = ["benchmark", "test-user", "test@example.com", "12345"];

    // 4-11. Type into up to 4 inputs, re-observe after each
    for (let i = 0; i < Math.min(inputIdMatches.length, 4); i++) {
      const typeResult = await client.callTool("charlotte:type", {
        element_id: inputIdMatches[i],
        text: testValues[i],
      });

      if (!typeResult.isError) {
        filledCount++;
      }

      // Re-observe (minimal) after each interaction
      await client.callTool("charlotte:observe", { detail: "minimal" });
    }

    // 12. Submit if we found a form
    let submitted = false;
    if (formIdMatches.length > 0) {
      const submitResult = await client.callTool("charlotte:submit", {
        form_id: formIdMatches[0],
      });
      submitted = !submitResult.isError;
    }

    // 13. Final observe to capture post-submit state
    await client.callTool("charlotte:observe", { detail: "minimal" });

    return {
      success: filledCount > 0,
      notes: `Found ${inputIdMatches.length} inputs, filled ${filledCount}, submitted: ${submitted}`,
    };
  },
};
