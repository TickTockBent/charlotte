import { describe, it, expect } from "vitest";
import { resolveOptions } from "../../../src/config/resolve.js";
import type { CliInputs, EnvInputs } from "../../../src/config/resolve.js";
import type { CharlotteFileConfig } from "../../../src/config/schema.js";

const noCli: CliInputs = {};
const noEnv: EnvInputs = {};
const noFile: CharlotteFileConfig = {};

describe("resolveOptions precedence (issue #19)", () => {
  it("falls back to defaults when nothing is provided", () => {
    const result = resolveOptions(noCli, noEnv, noFile);
    expect(result.headless).toBe(true);
    expect(result.noSandbox).toBe(false);
    expect(result.profile).toBeUndefined();
    expect(result.toolGroups).toBeUndefined();
    expect(result.cdpEndpoint).toBeUndefined();
  });

  describe("headless", () => {
    it("uses config file value when CLI absent", () => {
      const result = resolveOptions(noCli, noEnv, { browser: { headless: false } });
      expect(result.headless).toBe(false);
    });

    it("CLI overrides config file", () => {
      const result = resolveOptions({ headless: false }, noEnv, { browser: { headless: true } });
      expect(result.headless).toBe(false);
    });
  });

  describe("noSandbox (issue #184)", () => {
    it("defaults to false (sandbox ON)", () => {
      expect(resolveOptions(noCli, noEnv, noFile).noSandbox).toBe(false);
    });

    it("enabled via config file", () => {
      expect(resolveOptions(noCli, noEnv, { browser: { noSandbox: true } }).noSandbox).toBe(true);
    });

    it("enabled via env var", () => {
      expect(resolveOptions(noCli, { noSandbox: true }, noFile).noSandbox).toBe(true);
    });

    it("enabled via CLI", () => {
      expect(resolveOptions({ noSandbox: true }, noEnv, noFile).noSandbox).toBe(true);
    });

    it("CLI > env > file precedence", () => {
      // file true, env true, cli explicitly omitted -> stays true via env/file
      expect(
        resolveOptions(noCli, { noSandbox: false }, { browser: { noSandbox: true } }).noSandbox,
      ).toBe(false);
      // cli false would require explicit false; CliInputs only sets true on opt-out
      expect(
        resolveOptions({ noSandbox: true }, { noSandbox: false }, { browser: { noSandbox: false } })
          .noSandbox,
      ).toBe(true);
    });
  });

  describe("profile vs groups", () => {
    it("reads profile from config file", () => {
      const result = resolveOptions(noCli, noEnv, { tools: { profile: "full" } });
      expect(result.profile).toBe("full");
      expect(result.toolGroups).toBeUndefined();
    });

    it("reads groups from config file", () => {
      const result = resolveOptions(noCli, noEnv, {
        tools: { groups: ["navigation", "observation"] },
      });
      expect(result.toolGroups).toEqual(["navigation", "observation"]);
      expect(result.profile).toBeUndefined();
    });

    it("CLI profile overrides file groups (and clears groups)", () => {
      const result = resolveOptions({ profile: "core" }, noEnv, {
        tools: { groups: ["navigation"] },
      });
      expect(result.profile).toBe("core");
      expect(result.toolGroups).toBeUndefined();
    });

    it("config profile takes precedence over config groups", () => {
      const result = resolveOptions(noCli, noEnv, {
        tools: { profile: "browse", groups: ["navigation"] },
      });
      expect(result.profile).toBe("browse");
      expect(result.toolGroups).toBeUndefined();
    });
  });

  describe("cdpEndpoint", () => {
    it("reads from config file", () => {
      const result = resolveOptions(noCli, noEnv, {
        browser: { cdpEndpoint: "http://localhost:9222" },
      });
      expect(result.cdpEndpoint).toBe("http://localhost:9222");
    });

    it("treats null in config as unset", () => {
      const result = resolveOptions(noCli, noEnv, { browser: { cdpEndpoint: null } });
      expect(result.cdpEndpoint).toBeUndefined();
    });

    it("env overrides file", () => {
      const result = resolveOptions(
        noCli,
        { cdpEndpoint: "ws://env:9222" },
        { browser: { cdpEndpoint: "http://file:9222" } },
      );
      expect(result.cdpEndpoint).toBe("ws://env:9222");
    });

    it("CLI overrides env", () => {
      const result = resolveOptions(
        { cdpEndpoint: "http://cli:9222" },
        { cdpEndpoint: "ws://env:9222" },
        noFile,
      );
      expect(result.cdpEndpoint).toBe("http://cli:9222");
    });

    it("throws on invalid cdpEndpoint from config file", () => {
      expect(() => resolveOptions(noCli, noEnv, { browser: { cdpEndpoint: "banana" } })).toThrow(
        "Invalid cdpEndpoint",
      );
    });
  });

  describe("outputDir", () => {
    it("config file value used when CLI/env absent", () => {
      expect(resolveOptions(noCli, noEnv, { output: { dir: "./out" } }).outputDir).toBe("./out");
    });

    it("CLI overrides env overrides file", () => {
      expect(
        resolveOptions({ outputDir: "cli" }, { outputDir: "env" }, { output: { dir: "file" } })
          .outputDir,
      ).toBe("cli");
      expect(
        resolveOptions(noCli, { outputDir: "env" }, { output: { dir: "file" } }).outputDir,
      ).toBe("env");
    });
  });

  describe("runtime tunables from config file", () => {
    it("passes through snapshot, rendering, and dialog settings", () => {
      const result = resolveOptions(noCli, noEnv, {
        snapshot: { depth: 25, autoSnapshot: "manual" },
        rendering: { includeIframes: true, iframeDepth: 5 },
        dialog: { autoDismiss: "accept_all" },
      });
      expect(result.snapshotDepth).toBe(25);
      expect(result.autoSnapshot).toBe("manual");
      expect(result.includeIframes).toBe(true);
      expect(result.iframeDepth).toBe(5);
      expect(result.dialogAutoDismiss).toBe("accept_all");
    });

    it("passes through output-size limits (issue #188)", () => {
      const result = resolveOptions(noCli, noEnv, {
        limits: {
          maxInteractiveElements: 500,
          maxFullContentChars: 1000,
          maxResponseBytes: 50_000,
          maxEvaluateBytes: 10_000,
        },
      });
      expect(result.maxInteractiveElements).toBe(500);
      expect(result.maxFullContentChars).toBe(1000);
      expect(result.maxResponseBytes).toBe(50_000);
      expect(result.maxEvaluateBytes).toBe(10_000);
    });

    it("leaves limits undefined when no limits section is present", () => {
      const result = resolveOptions(noCli, noEnv, noFile);
      expect(result.maxInteractiveElements).toBeUndefined();
      expect(result.maxResponseBytes).toBeUndefined();
    });
  });

  describe("http block (remote design spec §5, slice 1 step 2)", () => {
    it("defaults to stdio mode", () => {
      expect(resolveOptions(noCli, noEnv, noFile).http).toBe(false);
    });

    it("--http switches the mode", () => {
      expect(resolveOptions({ http: true }, noEnv, noFile).http).toBe(true);
    });

    it("resolves the full default http config, with no default token", () => {
      expect(resolveOptions(noCli, noEnv, noFile).httpConfig).toEqual({
        port: 3737,
        host: "127.0.0.1",
        profile: "browse",
        debugRequests: false,
        sessionIdleTtlMs: 1_800_000,
        maxSessions: 1,
        allowPrivateNetworks: [],
        allowedHosts: [],
        enableDevTools: false,
        artifactDelivery: "inline",
      });
      expect(resolveOptions(noCli, noEnv, noFile).httpConfig.authToken).toBeUndefined();
    });

    it("reads reserved fields from the config file verbatim", () => {
      const result = resolveOptions(noCli, noEnv, {
        http: {
          sessionIdleTtlMs: 60_000,
          maxSessions: 4,
          allowPrivateNetworks: ["192.168.0.0/16"],
          enableDevTools: true,
          artifactDelivery: "resource",
        },
      });
      expect(result.httpConfig.sessionIdleTtlMs).toBe(60_000);
      expect(result.httpConfig.maxSessions).toBe(4);
      expect(result.httpConfig.allowPrivateNetworks).toEqual(["192.168.0.0/16"]);
      expect(result.httpConfig.enableDevTools).toBe(true);
      expect(result.httpConfig.artifactDelivery).toBe("resource");
    });

    it("does not share the default allowPrivateNetworks array between resolutions", () => {
      const first = resolveOptions(noCli, noEnv, noFile);
      first.httpConfig.allowPrivateNetworks.push("10.0.0.0/8");
      expect(resolveOptions(noCli, noEnv, noFile).httpConfig.allowPrivateNetworks).toEqual([]);
    });

    describe("authToken", () => {
      it("comes from the config file when no env var is set", () => {
        const result = resolveOptions(noCli, noEnv, { http: { authToken: "from-file" } });
        expect(result.httpConfig.authToken).toBe("from-file");
      });

      it("env wins over the config file", () => {
        const result = resolveOptions(
          noCli,
          { authToken: "from-env" },
          {
            http: { authToken: "from-file" },
          },
        );
        expect(result.httpConfig.authToken).toBe("from-env");
      });

      it("treats a null config value as unset", () => {
        const result = resolveOptions(noCli, noEnv, { http: { authToken: null } });
        expect(result.httpConfig.authToken).toBeUndefined();
      });
    });

    describe("port", () => {
      it("comes from the config file", () => {
        expect(resolveOptions(noCli, noEnv, { http: { port: 8080 } }).httpConfig.port).toBe(8080);
      });

      it("--port overrides the config file", () => {
        const result = resolveOptions({ port: 9000 }, noEnv, { http: { port: 8080 } });
        expect(result.httpConfig.port).toBe(9000);
      });
    });

    describe("profile", () => {
      it("comes from the http block, not tools.profile", () => {
        const result = resolveOptions(noCli, noEnv, {
          tools: { profile: "full" },
          http: { profile: "interact" },
        });
        expect(result.httpConfig.profile).toBe("interact");
      });

      it("--profile overrides http.profile (still fixed at startup)", () => {
        const result = resolveOptions({ profile: "audit" }, noEnv, { http: { profile: "browse" } });
        expect(result.httpConfig.profile).toBe("audit");
      });
    });

    describe("debugRequests", () => {
      it("defaults to off", () => {
        expect(resolveOptions(noCli, noEnv, noFile).httpConfig.debugRequests).toBe(false);
      });

      it("is enabled by the config file", () => {
        const result = resolveOptions(noCli, noEnv, { http: { debugRequests: true } });
        expect(result.httpConfig.debugRequests).toBe(true);
      });
    });

    describe("publicOrigin (OAuth facade switch, ⟨D2⟩)", () => {
      it("is absent by default, which is what keeps the facade off", () => {
        const { httpConfig } = resolveOptions(noCli, noEnv, noFile);
        expect(httpConfig.publicOrigin).toBeUndefined();
        expect("publicOrigin" in httpConfig).toBe(false);
      });

      it("comes from the config file", () => {
        const result = resolveOptions(noCli, noEnv, {
          http: { publicOrigin: "https://charlotte.example.com" },
        });
        expect(result.httpConfig.publicOrigin).toBe("https://charlotte.example.com");
      });

      it("treats a null config value as unset", () => {
        // Same rule as authToken: the key must not appear at all, or "unset"
        // and "set to nothing" become indistinguishable downstream.
        const result = resolveOptions(noCli, noEnv, { http: { publicOrigin: null } });
        expect("publicOrigin" in result.httpConfig).toBe(false);
      });
    });

    describe("host", () => {
      it("comes from the config file", () => {
        expect(resolveOptions(noCli, noEnv, { http: { host: "0.0.0.0" } }).httpConfig.host).toBe(
          "0.0.0.0",
        );
      });
    });
  });
});
