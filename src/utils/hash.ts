import { createHash } from "node:crypto";

/** Number of hex characters in a generated element-ID hash. */
export const HASH_HEX_LENGTH = 6;

/**
 * Produce a stable hex hash of the given input, truncated to
 * {@link HASH_HEX_LENGTH} characters.
 *
 * 6 hex chars = 24 bits = ~16.7M buckets. On a ~300-element page the
 * birthday-bound collision probability drops from ~50% (at 4 chars) to
 * well under 1%, which keeps disambiguator suffixes rare.
 */
export function hashToHex(input: string): string {
  const hash = createHash("md5").update(input).digest("hex");
  return hash.substring(0, HASH_HEX_LENGTH);
}
