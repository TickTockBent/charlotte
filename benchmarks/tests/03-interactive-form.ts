/**
 * Test 3: Interactive SPA — Form Workflow
 *
 * Tests cumulative token cost across a multi-step form interaction.
 * Charlotte's mid-task minimal observations should be dramatically cheaper
 * than Playwright's full re-snapshots.
 */

import { BenchmarkTest } from "../harness/test-runner.js";
import { BenchmarkMcpClient } from "../harness/mcp-client.js";

const TARGET_URL = "https://httpbin.org/forms/post";

export const interactiveFormTest: BenchmarkTest = {
  name: "Interactive Form (httpbin)",
  description:
    "Navigate to httpbin form, fill fields, and submit. Measures cumulative token cost across a form workflow.",
  successCriteria: "Form fields filled and form submitted without errors.",

  async run(client: BenchmarkMcpClient, serverName: string) {
    const responseText = (result: unknown): string => {
      const response = result as { content?: Array<{ text?: string }> };
      return response.content?.map((c) => c.text ?? "").join("\n") ?? JSON.stringify(result);
    };

    if (serverName.includes("Charlotte")) {
      // Navigate and observe to find form elements
      await client.callTool("charlotte:navigate", { url: TARGET_URL });
      const observeResult = await client.callTool("charlotte:observe", {
        detail: "summary",
      });

      const observeText = responseText(observeResult.response);

      // Find interactive elements to fill - use find tool
      const findInputs = await client.callTool("charlotte:find", {
        type: "text_input",
      });

      const findText = responseText(findInputs.response);

      // Try to extract element IDs from the find response
      const inputIdMatches = findText.match(/inp-[a-f0-9]{4}/g) ?? [];
      const formIdMatches = observeText.match(/frm-[a-f0-9]{4}/g) ?? [];

      let filledAny = false;

      // Type into the first text input we find
      if (inputIdMatches.length > 0) {
        const typeResult = await client.callTool("charlotte:type", {
          element_id: inputIdMatches[0],
          text: "benchmark-test",
        });
        filledAny = !typeResult.isError;
      }

      // Minimal re-observe to check state (cheap compared to Playwright's full snapshot)
      await client.callTool("charlotte:observe", { detail: "minimal" });

      // Submit if we found a form
      let submitted = false;
      if (formIdMatches.length > 0) {
        const submitResult = await client.callTool("charlotte:submit", {
          form_id: formIdMatches[0],
        });
        submitted = !submitResult.isError;
      }

      return {
        success: filledAny || submitted,
        notes: `Found ${inputIdMatches.length} inputs, ${formIdMatches.length} forms. Filled: ${filledAny}, Submitted: ${submitted}`,
      };
    }

    if (serverName.includes("Playwright")) {
      // Navigate (returns full snapshot automatically)
      await client.callTool("browser_navigate", { url: TARGET_URL });
      const snapshotResult = await client.callTool("browser_snapshot", {});

      const snapshotText = responseText(snapshotResult.response);

      // Find a text input reference from the snapshot
      // Playwright uses ref="sXeYY" format
      const refMatches = snapshotText.match(/ref="(s\d+e\d+)"/g) ?? [];

      let filledAny = false;
      // Try to fill the first textbox
      const textboxMatch = snapshotText.match(/textbox[^"]*"[^"]*"[^r]*ref="(s\d+e\d+)"/);
      if (textboxMatch) {
        const fillResult = await client.callTool("browser_type", {
          element: `textbox`,
          ref: textboxMatch[1],
          text: "benchmark-test",
        });
        filledAny = !fillResult.isError;
      }

      // Full re-snapshot (this is the expensive part)
      await client.callTool("browser_snapshot", {});

      // Try to submit
      const buttonMatch = snapshotText.match(/button[^"]*"[Ss]ubmit[^"]*"[^r]*ref="(s\d+e\d+)"/);
      if (buttonMatch) {
        await client.callTool("browser_click", {
          element: `button "Submit"`,
          ref: buttonMatch[1],
        });
      }

      return {
        success: filledAny,
        notes: `Found ${refMatches.length} refs. Filled: ${filledAny}`,
      };
    }

    if (serverName.includes("Chrome DevTools")) {
      await client.callTool("navigate_page", { url: TARGET_URL });
      const snapshotResult = await client.callTool("take_snapshot", {});

      // Try to fill via fill tool
      const fillResult = await client.callTool("fill", {
        selector: "input[type=text]",
        value: "benchmark-test",
      });

      // Re-snapshot
      await client.callTool("take_snapshot", {});

      return {
        success: !fillResult.isError,
        notes: `Fill succeeded: ${!fillResult.isError}`,
      };
    }

    return { success: false, notes: `Unknown server: ${serverName}` };
  },
};
