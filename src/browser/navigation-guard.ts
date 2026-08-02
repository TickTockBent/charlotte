/**
 * Outbound SSRF / navigation guard — the **classifier** (decisions D14 policy,
 * D15 mechanism; spikes s1-ssrf-spike.md and s2-proxy-spike.md).
 *
 * This module is pure policy: given a host, resolve it and decide whether its
 * IP falls in the default deny-set (loopback, RFC1918, link-local,
 * cloud-metadata, CGNAT/Tailscale, TEST-NET, plus the IPv6 analogs), with a CIDR
 * allowlist (`allowPrivateNetworks`) carving post-resolution exceptions. It has
 * no browser or CDP contact.
 *
 * The **enforcement** layer that consumes this classifier is the in-process
 * loopback filtering proxy in {@link ./filtering-proxy.ts} (D15). The proxy sits
 * below Puppeteer's target manager at the network layer, so it covers every
 * egress — including a popup's *initial* request, which the earlier CDP-`Fetch`
 * mechanism could not reach without tearing popups down (see s2-proxy-spike.md
 * and the D14 build finding). The check is always on the **resolved IP**, which
 * is what defeats `localtest.me`, `*.nip.io`, literal-metadata-IP names, and
 * IPv4-mapped IPv6 spellings regardless of how the host is written.
 */
import ipaddr from "ipaddr.js";
import dns from "node:dns";

/** Parsed-IP union returned by ipaddr.parse. */
type ParsedIP = ReturnType<typeof ipaddr.parse>;

/**
 * Default IPv4 deny ranges (D14 §4). Deny if the resolved IP falls in any of
 * these unless an allowlist CIDR carves it back out.
 */
export const DENY_RANGES_V4: readonly string[] = [
  "0.0.0.0/8", // "this host" / unspecified — reaches loopback on Linux
  "127.0.0.0/8", // loopback
  "10.0.0.0/8", // RFC1918
  "172.16.0.0/12", // RFC1918
  "192.168.0.0/16", // RFC1918
  "169.254.0.0/16", // link-local, incl. 169.254.169.254 cloud metadata
  "100.64.0.0/10", // CGNAT and Tailscale (also Alibaba metadata 100.100.100.200)
  // IETF protocol-assignment / benchmarking / TEST-NET:
  "192.0.0.0/24",
  "192.0.2.0/24",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
];

/** Default IPv6 deny ranges (D14 §4). IPv4-mapped/NAT64 are normalized first. */
export const DENY_RANGES_V6: readonly string[] = [
  "::1/128", // loopback
  "::/128", // unspecified
  "fe80::/10", // link-local
  "fc00::/7", // unique local (RFC1918 analog)
];

/** IPv6 ranges whose embedded IPv4 must be extracted and re-checked. */
const NAT64_RANGE = "64:ff9b::/96";
const IPV4_COMPAT_RANGE = "::/96";

export interface ClassifyResult {
  denied: boolean;
  /** The deny-set CIDR that matched, when denied by a default range. */
  matchedRange?: string;
}

export interface HostClassification {
  denied: boolean;
  /** The resolved (or literal) IP the decision was made against. */
  ip?: string;
  /** The deny-set CIDR that matched, when denied by a default range. */
  matchedRange?: string;
  /**
   * Distinguishes a fail-closed resolution failure from a deny-range hit, so
   * the caller can word the refusal differently.
   */
  reason?: "denied-range" | "resolution-failed";
}

/** Signature of the DNS lookup used by {@link resolveAndClassifyHost}. */
export type LookupAll = (host: string) => Promise<Array<{ address: string; family: number }>>;

/** Real DNS lookup (all answers). Written so a spy on it is honored per call. */
const defaultLookupAll: LookupAll = (host: string) =>
  new Promise((resolve, reject) => {
    dns.lookup(host, { all: true }, (error, addresses) => {
      if (error) reject(error);
      else resolve(addresses);
    });
  });

/** Return the CIDR from `cidrs` that contains `addr`, or undefined. */
function firstMatchingRange(addr: ParsedIP, cidrs: readonly string[]): string | undefined {
  for (const cidr of cidrs) {
    let parsed: [ParsedIP, number];
    try {
      parsed = ipaddr.parseCIDR(cidr);
    } catch {
      continue; // a malformed allowlist entry is ignored, not fatal
    }
    if (parsed[0].kind() !== addr.kind()) continue;
    if (addr.kind() === "ipv4" && parsed[0].kind() === "ipv4") {
      if ((addr as ipaddr.IPv4).match(parsed as [ipaddr.IPv4, number])) return cidr;
    } else if (addr.kind() === "ipv6" && parsed[0].kind() === "ipv6") {
      if ((addr as ipaddr.IPv6).match(parsed as [ipaddr.IPv6, number])) return cidr;
    }
  }
  return undefined;
}

/**
 * Reduce an IPv4-mapped / NAT64 / IPv4-compatible IPv6 address to its embedded
 * IPv4 form so it is checked against the IPv4 rules (a known bypass class). The
 * loopback/unspecified literals (`::1`, `::`) are left alone so their own /128
 * rules report the accurate matched range. Any other address is returned
 * unchanged.
 */
function normalizeEmbeddedIPv4(addr: ParsedIP): ParsedIP {
  if (addr.kind() !== "ipv6") return addr;
  const v6 = addr as ipaddr.IPv6;

  if (v6.isIPv4MappedAddress()) {
    return v6.toIPv4Address();
  }

  // Leave ::1 and :: to the explicit IPv6 /128 rules.
  if (firstMatchingRange(addr, ["::1/128", "::/128"])) return addr;

  if (firstMatchingRange(addr, [NAT64_RANGE, IPV4_COMPAT_RANGE])) {
    const bytes = v6.toByteArray();
    return ipaddr.fromByteArray(bytes.slice(12)); // last 4 bytes = embedded IPv4
  }

  return addr;
}

/**
 * Classify a single already-resolved IP literal against the deny-set and the
 * post-resolution allowlist. The allowlist wins for the CIDR it covers.
 */
export function classifyAddress(ip: string, allowlist: string[]): ClassifyResult {
  let parsed: ParsedIP;
  try {
    parsed = ipaddr.parse(ip);
  } catch {
    // A DNS answer is always a valid literal; an unparseable one is treated as
    // denied (fail closed) rather than silently allowed.
    return { denied: true };
  }

  const normalized = normalizeEmbeddedIPv4(parsed);

  // Allowlist carve-out is checked first: an allowlisted CIDR wins over the
  // default deny for exactly the range it covers.
  if (firstMatchingRange(normalized, allowlist)) {
    return { denied: false };
  }

  const denyRanges = normalized.kind() === "ipv4" ? DENY_RANGES_V4 : DENY_RANGES_V6;
  const matchedRange = firstMatchingRange(normalized, denyRanges);
  if (matchedRange) {
    return { denied: true, matchedRange };
  }
  return { denied: false };
}

/** Strip the surrounding brackets from an IPv6-literal hostname (`[::1]`). */
export function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/**
 * Resolve a host and classify it: deny if **any** resolved address is denied (a
 * name with one public + one private answer is an attack). Literal IPs skip
 * DNS. **Fails closed**: a resolution failure is treated as denied and flagged
 * with a distinct reason. On the allow path, `ip` is a vetted address the caller
 * should connect to (IP-pin) so no second, attacker-controlled resolution can
 * swap in a private IP.
 */
export async function resolveAndClassifyHost(
  host: string,
  allowlist: string[],
  lookupAll: LookupAll = defaultLookupAll,
): Promise<HostClassification> {
  const literal = stripBrackets(host);
  if (ipaddr.isValid(literal)) {
    const result = classifyAddress(literal, allowlist);
    return {
      denied: result.denied,
      ip: literal,
      ...(result.matchedRange ? { matchedRange: result.matchedRange } : {}),
      ...(result.denied ? { reason: "denied-range" as const } : {}),
    };
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookupAll(host);
  } catch {
    return { denied: true, reason: "resolution-failed" };
  }
  if (!addresses || addresses.length === 0) {
    return { denied: true, reason: "resolution-failed" };
  }

  for (const { address } of addresses) {
    const result = classifyAddress(address, allowlist);
    if (result.denied) {
      return {
        denied: true,
        ip: address,
        ...(result.matchedRange ? { matchedRange: result.matchedRange } : {}),
        reason: "denied-range",
      };
    }
  }
  // All answers allowed: return the first, which the allow path pins to.
  return { denied: false, ip: addresses[0].address };
}

/** Minimal logger shape the guard needs. */
export interface GuardLogger {
  debug(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

/** What the guard reports to its owner when it blocks a request. */
export interface NavigationDenyInfo {
  url: string;
  ip?: string;
  matchedRange?: string;
  reason?: "denied-range" | "resolution-failed";
}
