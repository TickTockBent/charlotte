import { createHash } from "node:crypto";

export function hashToHex4(input: string): string {
  const hash = createHash("md5").update(input).digest("hex");
  return hash.substring(0, 4);
}
