import { describe, it, expect } from "vitest";

// @puppeteer/browsers 3.x unpacks Chrome for Testing with either a system
// `unzip` or the optional `yauzl` peer. Without one, Chrome silently fails to
// download on hosts like node:22-slim (D36), so this dependency is
// load-bearing even though src/ never imports it.
describe("Chrome for Testing extraction dependency", () => {
  it("resolves yauzl so @puppeteer/browsers can unpack Chrome without unzip", async () => {
    const yauzlModule = (await import("yauzl")) as unknown as {
      default: { open: unknown };
    };
    expect(typeof yauzlModule.default.open).toBe("function");
  });
});
