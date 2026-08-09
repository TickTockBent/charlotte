/**
 * Shared sandbox-mode env gate for test harnesses (I9 — docs/remote §9).
 *
 * Test harnesses default to launching Chromium with the sandbox DISABLED
 * (`noSandbox: true`) because the dev host and CI cannot sandbox under
 * Ubuntu 24.04's unprivileged-userns lockdown (see #184). This is an
 * env-gated dimension so a container built with the sandbox posture (D22)
 * can flip it on to prove Charlotte's browser scenarios actually run
 * sandboxed.
 *
 * Default (env var unset) preserves today's behavior exactly:
 * `resolveTestNoSandbox() === true`. Only `CHARLOTTE_NO_SANDBOX=0` flips the
 * sandbox on (`resolveTestNoSandbox() === false`). Any other value (unset,
 * "1", "true", etc.) leaves the default untouched.
 */
export function resolveTestNoSandbox(): boolean {
  return process.env.CHARLOTTE_NO_SANDBOX === "0" ? false : true;
}
