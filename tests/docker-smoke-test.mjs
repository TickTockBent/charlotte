#!/usr/bin/env node
/**
 * Docker smoke test for Charlotte MCP server.
 * Spawns a container, sends MCP tool calls over stdio, verifies responses.
 * Usage: node tests/docker-smoke-test.mjs <image-tag>
 */

import { spawn } from "child_process";

const IMAGE = process.argv[2] || "charlotte:alpine";
const SANDBOX_URL = "http://host.docker.internal:9876";
// On Linux, host.docker.internal may not work — use --network=host instead
const USE_HOST_NETWORK = process.platform === "linux";
const BASE_URL = USE_HOST_NETWORK ? "http://localhost:9876" : SANDBOX_URL;

let messageId = 0;
let responseBuffer = "";
let pendingResolve = null;

function startContainer() {
  const dockerArgs = ["run", "-i", "--rm", "--shm-size=2gb"];
  if (USE_HOST_NETWORK) {
    dockerArgs.push("--network=host");
  }
  dockerArgs.push(IMAGE);

  const container = spawn("docker", dockerArgs, {
    stdio: ["pipe", "pipe", "pipe"],
  });

  container.stdout.on("data", (chunk) => {
    responseBuffer += chunk.toString();
    const lines = responseBuffer.split("\n");
    responseBuffer = lines.pop(); // keep incomplete line
    for (const line of lines) {
      if (line.trim() && pendingResolve) {
        try {
          const parsed = JSON.parse(line.trim());
          const resolve = pendingResolve;
          pendingResolve = null;
          resolve(parsed);
        } catch {
          // not JSON, skip (could be stderr leak)
        }
      }
    }
  });

  container.stderr.on("data", (chunk) => {
    // Log stderr for debugging but don't fail
    const text = chunk.toString().trim();
    if (text && !text.includes("Launching") && !text.includes("launched")) {
      process.stderr.write(`  [container stderr] ${text}\n`);
    }
  });

  return container;
}

function sendMessage(container, message) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingResolve = null;
      reject(new Error(`Timeout waiting for response to: ${message.method || "id:" + message.id}`));
    }, 30000);

    pendingResolve = (parsed) => {
      clearTimeout(timeout);
      resolve(parsed);
    };

    container.stdin.write(JSON.stringify(message) + "\n");
  });
}

function sendNotification(container, method, params = {}) {
  container.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

async function callTool(container, toolName, args = {}) {
  const id = ++messageId;
  const response = await sendMessage(container, {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: toolName, arguments: args },
  });
  return response;
}

function assertOk(response, label) {
  if (response.error) {
    throw new Error(`${label}: MCP error ${response.error.code}: ${response.error.message}`);
  }
  if (!response.result) {
    throw new Error(`${label}: No result in response`);
  }
  const content = response.result.content?.[0]?.text || "";
  if (response.result.isError) {
    throw new Error(`${label}: Tool error: ${content.slice(0, 200)}`);
  }
  return content;
}

function getContentJson(content) {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// ─── Test suite ───────────────────────────────────────────────────────────

async function runTests(container) {
  const results = [];
  const startTime = Date.now();

  function log(label, passed, detail = "") {
    const mark = passed ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
    const elapsed = Date.now() - startTime;
    console.log(`  [${String(elapsed).padStart(6)}ms] ${mark} ${label}${detail ? ` — ${detail}` : ""}`);
    results.push({ label, passed });
  }

  // 1. Initialize
  const initResponse = await sendMessage(container, {
    jsonrpc: "2.0",
    id: ++messageId,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "docker-smoke-test", version: "1.0" },
    },
  });
  const hasServerInfo = initResponse.result?.serverInfo?.name === "charlotte";
  log("initialize", hasServerInfo, `server: ${initResponse.result?.serverInfo?.name}`);

  // Send initialized notification
  sendNotification(container, "notifications/initialized");
  await new Promise((r) => setTimeout(r, 500));

  // 2. List tools
  const toolsResponse = await sendMessage(container, {
    jsonrpc: "2.0",
    id: ++messageId,
    method: "tools/list",
    params: {},
  });
  const toolCount = toolsResponse.result?.tools?.length || 0;
  log("tools/list", toolCount > 15, `${toolCount} tools registered`);

  // 3. Navigate to sandbox index
  let response = await callTool(container, "charlotte:navigate", { url: `${BASE_URL}/index.html` });
  let content = assertOk(response, "navigate");
  let json = getContentJson(content);
  log("navigate", json?.title?.includes("Charlotte") || content.includes("Charlotte"), `title: ${json?.title || "?"}`);

  // 4. Observe (summary)
  response = await callTool(container, "charlotte:observe", { detail: "summary" });
  content = assertOk(response, "observe:summary");
  json = getContentJson(content);
  const hasInteractive = json?.interactive?.length > 0 || content.includes("interactive");
  log("observe (summary)", hasInteractive, `interactive elements found`);

  // 5. Observe (minimal)
  response = await callTool(container, "charlotte:observe", { detail: "minimal" });
  content = assertOk(response, "observe:minimal");
  log("observe (minimal)", content.length < 5000, `${content.length} chars`);

  // 6. Find — search for links
  response = await callTool(container, "charlotte:find", { type: "link" });
  content = assertOk(response, "find:links");
  json = getContentJson(content);
  const linkCount = Array.isArray(json) ? json.length : 0;
  log("find (links)", linkCount > 0, `${linkCount} links found`);

  // 7. Navigate to forms page
  response = await callTool(container, "charlotte:navigate", { url: `${BASE_URL}/forms.html` });
  content = assertOk(response, "navigate:forms");
  log("navigate (forms)", content.includes("form") || content.includes("Form"), "forms page loaded");

  // 8. Observe forms page
  response = await callTool(container, "charlotte:observe", { detail: "summary" });
  content = assertOk(response, "observe:forms");
  json = getContentJson(content);
  const hasForms = json?.forms?.length > 0 || content.includes("forms");
  log("observe (forms)", hasForms, "forms detected");

  // 9. Find text inputs
  response = await callTool(container, "charlotte:find", { type: "text_input" });
  content = assertOk(response, "find:text_input");
  json = getContentJson(content);
  const inputResults = Array.isArray(json) ? json : [];
  const hasInputs = inputResults.length > 0;
  log("find (text_input)", hasInputs, `${inputResults.length} inputs found`);

  // 10. Type into first input (if found)
  if (inputResults.length > 0) {
    const firstInputId = inputResults[0].id;
    response = await callTool(container, "charlotte:type", {
      element_id: firstInputId,
      text: "Docker smoke test",
    });
    content = assertOk(response, "type");
    log("type", true, `typed into ${firstInputId}`);
  } else {
    log("type", false, "no inputs to type into");
  }

  // 11. Navigate to interactive page
  response = await callTool(container, "charlotte:navigate", { url: `${BASE_URL}/interactive.html` });
  content = assertOk(response, "navigate:interactive");
  log("navigate (interactive)", true, "interactive page loaded");

  // 12. Find buttons
  response = await callTool(container, "charlotte:find", { type: "button" });
  content = assertOk(response, "find:buttons");
  json = getContentJson(content);
  const buttonResults = Array.isArray(json) ? json : [];
  log("find (buttons)", buttonResults.length > 0, `${buttonResults.length} buttons found`);

  // 13. Click a button (if found)
  if (buttonResults.length > 0) {
    const firstButtonId = buttonResults[0].id;
    response = await callTool(container, "charlotte:click", { element_id: firstButtonId });
    content = assertOk(response, "click");
    log("click", true, `clicked ${firstButtonId}`);
  } else {
    log("click", false, "no buttons to click");
  }

  // 14. Screenshot
  response = await callTool(container, "charlotte:screenshot", {});
  const screenshotOk = !response.error && response.result?.content?.[0];
  log("screenshot", screenshotOk, screenshotOk ? "image captured" : "failed");

  // 15. Evaluate JS
  response = await callTool(container, "charlotte:evaluate", { expression: "document.title" });
  content = assertOk(response, "evaluate");
  log("evaluate", content.length > 0, `result: ${content.slice(0, 60)}`);

  // 16. Scroll
  response = await callTool(container, "charlotte:scroll", { direction: "down" });
  content = assertOk(response, "scroll");
  log("scroll", true, "scrolled down");

  // 17. Back navigation
  response = await callTool(container, "charlotte:back", {});
  content = assertOk(response, "back");
  log("back", true, "navigated back");

  // 18. Forward navigation
  response = await callTool(container, "charlotte:forward", {});
  content = assertOk(response, "forward");
  log("forward", true, "navigated forward");

  // 19. Diff (snapshot comparison)
  response = await callTool(container, "charlotte:diff", {});
  const diffOk = !response.error;
  log("diff", diffOk, diffOk ? "diff computed" : "diff failed");

  // 20. Configure
  response = await callTool(container, "charlotte:configure", { auto_snapshot: "every_action" });
  content = assertOk(response, "configure");
  log("configure", true, "config updated");

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const totalTime = Date.now() - startTime;
  console.log(`\n  ${passed}/${total} passed in ${(totalTime / 1000).toFixed(1)}s`);
  return { passed, total, totalTime };
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nTesting ${IMAGE}...`);
  const container = startContainer();

  try {
    const { passed, total, totalTime } = await runTests(container);

    container.stdin.end();
    container.kill();

    if (passed < total) {
      console.log(`\n  \x1b[31m${total - passed} test(s) failed\x1b[0m\n`);
      process.exitCode = 1;
    } else {
      console.log(`\n  \x1b[32mAll tests passed (${(totalTime / 1000).toFixed(1)}s)\x1b[0m\n`);
    }
  } catch (error) {
    console.error(`\n  \x1b[31mFATAL: ${error.message}\x1b[0m\n`);
    container.stdin.end();
    container.kill();
    process.exitCode = 1;
  }
}

main();
