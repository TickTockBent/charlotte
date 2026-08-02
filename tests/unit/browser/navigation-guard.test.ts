import { describe, it, expect } from "vitest";
import {
  classifyAddress,
  resolveAndClassifyHost,
  DENY_RANGES_V4,
  DENY_RANGES_V6,
  type LookupAll,
} from "../../../src/browser/navigation-guard.js";

/**
 * Unit coverage for the SSRF guard's classification core (D14). No browser,
 * no CDP — just the deny-set, the normalization, the allowlist carve, and the
 * resolve-and-classify contract (deny-if-any-answer, fail-closed). DNS is
 * injected via the {@link LookupAll} seam so these stay deterministic and
 * offline.
 */
describe("classifyAddress — default deny-set", () => {
  const cases: Array<{ ip: string; range: string; note: string }> = [
    { ip: "0.0.0.0", range: "0.0.0.0/8", note: "unspecified / this-host" },
    { ip: "127.0.0.1", range: "127.0.0.0/8", note: "loopback" },
    { ip: "127.1.2.3", range: "127.0.0.0/8", note: "loopback (whole /8)" },
    { ip: "10.1.2.3", range: "10.0.0.0/8", note: "RFC1918 /8" },
    { ip: "172.16.5.5", range: "172.16.0.0/12", note: "RFC1918 /12" },
    { ip: "172.31.255.254", range: "172.16.0.0/12", note: "RFC1918 /12 upper" },
    { ip: "192.168.1.1", range: "192.168.0.0/16", note: "RFC1918 /16" },
    { ip: "169.254.169.254", range: "169.254.0.0/16", note: "cloud metadata" },
    { ip: "100.100.100.200", range: "100.64.0.0/10", note: "CGNAT/Alibaba metadata" },
    { ip: "100.64.0.1", range: "100.64.0.0/10", note: "CGNAT/Tailscale" },
    { ip: "192.0.0.1", range: "192.0.0.0/24", note: "IETF protocol assignment" },
    { ip: "192.0.2.5", range: "192.0.2.0/24", note: "TEST-NET-1" },
    { ip: "198.18.0.1", range: "198.18.0.0/15", note: "benchmarking" },
    { ip: "198.51.100.1", range: "198.51.100.0/24", note: "TEST-NET-2" },
    { ip: "203.0.113.1", range: "203.0.113.0/24", note: "TEST-NET-3" },
    { ip: "::1", range: "::1/128", note: "IPv6 loopback" },
    { ip: "::", range: "::/128", note: "IPv6 unspecified" },
    { ip: "fe80::1", range: "fe80::/10", note: "IPv6 link-local" },
    { ip: "fc00::1", range: "fc00::/7", note: "IPv6 unique-local" },
    { ip: "fd12:3456::1", range: "fc00::/7", note: "IPv6 unique-local (fd)" },
  ];

  for (const { ip, range, note } of cases) {
    it(`denies ${ip} → ${range} (${note})`, () => {
      const result = classifyAddress(ip, []);
      expect(result.denied).toBe(true);
      expect(result.matchedRange).toBe(range);
    });
  }

  it("normalizes IPv4-mapped IPv6 and denies via the IPv4 rules", () => {
    const result = classifyAddress("::ffff:127.0.0.1", []);
    expect(result.denied).toBe(true);
    expect(result.matchedRange).toBe("127.0.0.0/8");
  });

  it("normalizes an IPv4-mapped RFC1918 address", () => {
    const result = classifyAddress("::ffff:10.0.0.5", []);
    expect(result.denied).toBe(true);
    expect(result.matchedRange).toBe("10.0.0.0/8");
  });

  it("normalizes a NAT64-embedded private IPv4 (64:ff9b::)", () => {
    // 64:ff9b::7f00:1 embeds 127.0.0.1.
    const result = classifyAddress("64:ff9b::7f00:1", []);
    expect(result.denied).toBe(true);
    expect(result.matchedRange).toBe("127.0.0.0/8");
  });

  it("allows an unparseable / mangled input by failing closed (denied)", () => {
    // A DNS answer is always valid; a mangled literal must not silently pass.
    expect(classifyAddress("not-an-ip", []).denied).toBe(true);
  });
});

describe("classifyAddress — public addresses are allowed", () => {
  const publicIps = ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"];
  for (const ip of publicIps) {
    it(`allows public ${ip}`, () => {
      const result = classifyAddress(ip, []);
      expect(result.denied).toBe(false);
      expect(result.matchedRange).toBeUndefined();
    });
  }
});

describe("classifyAddress — allowlist carve-out wins for its covered CIDR", () => {
  it("allows a loopback IP when 127.0.0.0/8 is allowlisted", () => {
    expect(classifyAddress("127.0.0.1", ["127.0.0.0/8"]).denied).toBe(false);
  });

  it("allows an RFC1918 IP inside a narrow allowlisted CIDR", () => {
    expect(classifyAddress("10.0.5.7", ["10.0.5.0/24"]).denied).toBe(false);
  });

  it("still denies an RFC1918 IP OUTSIDE the allowlisted CIDR", () => {
    const result = classifyAddress("10.9.0.1", ["10.0.5.0/24"]);
    expect(result.denied).toBe(true);
    expect(result.matchedRange).toBe("10.0.0.0/8");
  });

  it("allows an allowlisted IPv4-mapped IPv6 (allowlist applies post-normalization)", () => {
    expect(classifyAddress("::ffff:127.0.0.1", ["127.0.0.0/8"]).denied).toBe(false);
  });

  it("does not let an IPv4 allowlist entry carve an IPv6 address", () => {
    // Kind mismatch: a v4 allowlist must not accidentally allow a v6 loopback.
    expect(classifyAddress("::1", ["127.0.0.0/8"]).denied).toBe(true);
  });
});

describe("deny-set exports are the pinned D14 §4 set", () => {
  it("IPv4 ranges match D14 exactly", () => {
    expect([...DENY_RANGES_V4]).toEqual([
      "0.0.0.0/8",
      "127.0.0.0/8",
      "10.0.0.0/8",
      "172.16.0.0/12",
      "192.168.0.0/16",
      "169.254.0.0/16",
      "100.64.0.0/10",
      "192.0.0.0/24",
      "192.0.2.0/24",
      "198.18.0.0/15",
      "198.51.100.0/24",
      "203.0.113.0/24",
    ]);
  });

  it("IPv6 ranges match D14 exactly", () => {
    expect([...DENY_RANGES_V6]).toEqual(["::1/128", "::/128", "fe80::/10", "fc00::/7"]);
  });
});

describe("resolveAndClassifyHost — literal IPs skip DNS", () => {
  const neverCalled: LookupAll = () => {
    throw new Error("DNS lookup must not be called for a literal IP");
  };

  it("denies a literal loopback with reason denied-range", async () => {
    const result = await resolveAndClassifyHost("127.0.0.1", [], neverCalled);
    expect(result).toMatchObject({
      denied: true,
      ip: "127.0.0.1",
      matchedRange: "127.0.0.0/8",
      reason: "denied-range",
    });
  });

  it("allows a literal public IP", async () => {
    const result = await resolveAndClassifyHost("8.8.8.8", [], neverCalled);
    expect(result).toMatchObject({ denied: false, ip: "8.8.8.8" });
  });

  it("denies a bracketed IPv6 loopback literal", async () => {
    const result = await resolveAndClassifyHost("[::1]", [], neverCalled);
    expect(result.denied).toBe(true);
    expect(result.matchedRange).toBe("::1/128");
  });
});

describe("resolveAndClassifyHost — DNS answers", () => {
  it("denies if ANY resolved answer is private (public + private mix is an attack)", async () => {
    const lookup: LookupAll = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ];
    const result = await resolveAndClassifyHost("rebind.example", [], lookup);
    expect(result.denied).toBe(true);
    expect(result.ip).toBe("127.0.0.1");
    expect(result.matchedRange).toBe("127.0.0.0/8");
  });

  it("allows a name that resolves only to public addresses", async () => {
    const lookup: LookupAll = async () => [{ address: "93.184.216.34", family: 4 }];
    const result = await resolveAndClassifyHost("example.com", [], lookup);
    expect(result).toMatchObject({ denied: false, ip: "93.184.216.34" });
  });

  it("allows a name that resolves into an allowlisted private CIDR", async () => {
    const lookup: LookupAll = async () => [{ address: "10.0.0.5", family: 4 }];
    const result = await resolveAndClassifyHost("intranet.local", ["10.0.0.0/8"], lookup);
    expect(result.denied).toBe(false);
  });

  it("fails CLOSED (denied) when resolution throws", async () => {
    const lookup: LookupAll = async () => {
      throw new Error("ENOTFOUND");
    };
    const result = await resolveAndClassifyHost("does-not-resolve.invalid", [], lookup);
    expect(result).toMatchObject({ denied: true, reason: "resolution-failed" });
    expect(result.ip).toBeUndefined();
  });

  it("fails CLOSED (denied) when resolution returns no answers", async () => {
    const lookup: LookupAll = async () => [];
    const result = await resolveAndClassifyHost("empty.invalid", [], lookup);
    expect(result).toMatchObject({ denied: true, reason: "resolution-failed" });
  });
});
