/**
 * Minimal OAuth 2.1 provider facade (⟨D2⟩, docs/remote/oauth-facade-design.md).
 *
 * claude.ai's connector add flow cannot present a static bearer token: the UI
 * offers a URL and (optionally) an OAuth client id/secret, nothing else. The
 * Session-A observation run (2026-08-02) captured the exact discovery chain it
 * walks when no client credentials are supplied — RFC 9728 protected-resource
 * metadata (path-scoped, then root), RFC 8414 authorization-server metadata,
 * then an unprompted `POST /register` (RFC 7591 DCR). This module answers that
 * chain, and nothing more.
 *
 * ## What this is NOT
 *
 * It is not an identity provider. There are no users, no client database, no
 * sessions, and nothing on disk. **The operator token
 * (`CHARLOTTE_AUTH_TOKEN`) remains the single root of trust**; every artifact
 * the facade mints — client ids, authorization codes, the access token — is
 * HMAC-derived from it. Three consequences worth stating plainly:
 *
 *  - Restarts change nothing (derivations are deterministic, not random).
 *  - Revocation is "rotate the operator token"; there is no revoke endpoint
 *    because every derived artifact dies with the key that produced it.
 *  - Authorization is the operator typing their own token into the consent
 *    form. The OAuth dance is packaging around that one decision.
 *
 * ## Security posture (and its accepted limits)
 *
 *  - Codes are stateless: signed, 120-second, PKCE-bound blobs. Single-use is
 *    NOT enforced (there is nowhere to record use). Accepted interim risk per
 *    the design doc — PKCE binds the code to a verifier only the real client
 *    holds, and the window is short. Revisit when multi-session lands.
 *  - Redirect URIs are https-only, with `http://localhost` / `http://127.0.0.1`
 *    permitted so a self-hoster can exercise the flow locally. Enforced at
 *    BOTH registration and authorization, and the code binds the redirect URI
 *    by hash so `/oauth/token` can prove the same one came back.
 *  - Every value that reaches the consent page — client id, redirect URI,
 *    state, challenge — arrives from an unauthenticated DCR/authorize request
 *    and is attacker-controlled. All of it is HTML-escaped on the way out
 *    ({@link escapeHtml}); the page contains no script at all and says so in a
 *    CSP header.
 *  - The consent POST body carries the operator token. Request observation
 *    (`CHARLOTTE_DEBUG_HTTP`) logs method, path, and redacted headers only —
 *    never bodies. Nothing in this module may add body logging, and the form
 *    must stay a POST so the token never lands in a query string (which IS
 *    logged, verbatim, via `originalUrl`).
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { logger } from "../utils/logger.js";

/** Settings for {@link mountOauthFacade}. */
export interface OauthFacadeOptions {
  /**
   * Public https origin this server is reached at, already normalized by
   * {@link normalizePublicOrigin} (scheme + host + port, no trailing slash).
   * Metadata documents advertise absolute URLs under it, so it must be what
   * the *client* sees, not the bind address.
   */
  publicOrigin: string;
  /** The operator token — HMAC key for every derived artifact, and the consent password. */
  operatorToken: string;
}

/** What the transport needs back from a mounted facade. */
export interface OauthFacadeHandle {
  /**
   * The derived bearer the token endpoint hands out. The `/mcp` middleware
   * accepts it alongside the operator token; it is deliberately distinguishable
   * (prefix + different value) so an operator can tell a connector-issued
   * credential from their own in logs.
   */
  accessToken: string;
  /** Absolute URL of the RFC 9728 document, for the `WWW-Authenticate` challenge. */
  protectedResourceMetadataUrl: string;
}

/** Lifetime of an authorization code. Long enough for a redirect, short enough to be a bad target. */
const AUTHORIZATION_CODE_TTL_SECONDS = 120;

/** Prefix on the derived access token — makes it greppable and obviously not the operator token. */
const ACCESS_TOKEN_PREFIX = "charlotte_at_";

/** Prefix on a derived client id. */
const CLIENT_ID_PREFIX = "charlotte-client-";

/** Hosts allowed to use plain http in a redirect URI (local development only). */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Form/query fields the consent page round-trips from the GET to the POST. */
const AUTHORIZE_PARAMETER_NAMES = [
  "response_type",
  "client_id",
  "redirect_uri",
  "state",
  "scope",
  "code_challenge",
  "code_challenge_method",
  "resource",
] as const;

/** Request bodies here are tiny; anything larger is not a legitimate client. */
const BODY_SIZE_LIMIT = "16kb";

/**
 * Normalize and validate an operator-supplied public origin.
 *
 * Returns the bare origin (`https://host[:port]`) — trailing slashes, default
 * ports and any path are stripped or rejected, so metadata URLs built by
 * string concatenation can never end up with a doubled or missing separator.
 *
 * Throws (at startup, before anything is listening) rather than degrading: a
 * mistyped origin would otherwise publish metadata pointing somewhere else,
 * which fails confusingly at the client end days later.
 */
export function normalizePublicOrigin(rawOrigin: string): string {
  const trimmed = rawOrigin.trim();
  const invalid = (reason: string): Error =>
    new Error(
      `Invalid http.publicOrigin ${JSON.stringify(rawOrigin)}: ${reason}. ` +
        'Expected the absolute https origin clients reach this server at, e.g. "https://charlotte.example.com".',
    );

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw invalid("not an absolute URL");
  }
  if (parsed.protocol !== "https:") {
    // OAuth metadata, authorization redirects and bearer tokens all cross this
    // origin; plain http would put the operator token on the wire in clear.
    throw invalid("must use https");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw invalid("must not contain credentials");
  }
  if (parsed.search !== "" || parsed.hash !== "") {
    throw invalid("must not contain a query string or fragment");
  }
  if (parsed.pathname !== "" && parsed.pathname !== "/") {
    // Charlotte's routes are root-mounted; a path prefix here would advertise
    // endpoints that do not exist.
    throw invalid("must not contain a path");
  }
  return parsed.origin;
}

/**
 * Constant-time matcher over a set of expected secrets.
 *
 * Both sides are SHA-256 digests so `timingSafeEqual` always receives two
 * 32-byte buffers — it throws on length mismatch, and comparing raw secrets
 * would leak the expected length through that throw.
 *
 * Every candidate is compared on every call, with no short-circuit: the
 * `timingSafeEqual(...) || matched` order forces the comparison to run before
 * the boolean OR, so which secret matched (and whether any did) costs the same.
 */
export function makeSecretMatcher(
  expectedSecrets: readonly string[],
): (presented: string | undefined) => boolean {
  const expectedDigests = expectedSecrets.map((secret) =>
    createHash("sha256").update(secret, "utf8").digest(),
  );

  return (presented: string | undefined): boolean => {
    if (typeof presented !== "string") return false;
    const presentedDigest = createHash("sha256").update(presented, "utf8").digest();
    let matched = false;
    for (const expectedDigest of expectedDigests) {
      matched = timingSafeEqual(expectedDigest, presentedDigest) || matched;
    }
    return matched;
  };
}

/** Domain-separated HMAC over the operator token. */
function derive(operatorToken: string, message: string): Buffer {
  return createHmac("sha256", operatorToken).update(message, "utf8").digest();
}

/**
 * The bearer `/oauth/token` issues. Deterministic in the operator token, so it
 * survives restarts without storage and dies the moment the token rotates.
 */
export function deriveAccessToken(operatorToken: string): string {
  return ACCESS_TOKEN_PREFIX + derive(operatorToken, "access-token-v1").toString("hex");
}

/**
 * The client id `/oauth/register` echoes back: an HMAC tag over the registered
 * redirect URI set, sorted so the same set in a different order registers as
 * the same client. Deterministic → re-registration after a restart (which
 * claude.ai does) yields the identical id instead of leaking a new one.
 */
export function deriveClientId(operatorToken: string, redirectUris: readonly string[]): string {
  const canonical = [...redirectUris].sort().join("\n");
  return (
    CLIENT_ID_PREFIX +
    derive(operatorToken, `client-id-v1\n${canonical}`).toString("hex").slice(0, 32)
  );
}

/** Hash binding a redirect URI into a code without carrying the URI itself. */
function hashRedirectUri(operatorToken: string, redirectUri: string): string {
  return derive(operatorToken, `redirect-uri-v1\n${redirectUri}`).toString("hex").slice(0, 32);
}

/** The claims an authorization code carries. Everything `/oauth/token` must re-check. */
interface AuthorizationCodePayload {
  /** PKCE S256 challenge, base64url. */
  challenge: string;
  client_id: string;
  redirect_uri_hash: string;
  /** Expiry, seconds since epoch. */
  exp: number;
}

/** Inputs for {@link mintAuthorizationCode}. */
export interface MintAuthorizationCodeParams {
  operatorToken: string;
  clientId: string;
  redirectUri: string;
  /** PKCE code challenge (S256, base64url). */
  challenge: string;
  /** Absolute expiry in ms since epoch. Defaults to now + 120s. */
  expiresAtMs?: number;
}

/**
 * Mint a signed, self-describing authorization code.
 *
 * Exported so tests can craft an already-expired code without a clock seam in
 * the request path: verification always reads the real `Date.now()`, and the
 * only injectable moment is the one the *caller* chose when minting. That
 * keeps the production code free of test-only plumbing.
 */
export function mintAuthorizationCode(params: MintAuthorizationCodeParams): string {
  const expiresAtMs = params.expiresAtMs ?? Date.now() + AUTHORIZATION_CODE_TTL_SECONDS * 1000;
  const payload: AuthorizationCodePayload = {
    challenge: params.challenge,
    client_id: params.clientId,
    redirect_uri_hash: hashRedirectUri(params.operatorToken, params.redirectUri),
    exp: Math.floor(expiresAtMs / 1000),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = derive(params.operatorToken, encodedPayload).toString("base64url");
  return `${encodedPayload}.${signature}`;
}

/**
 * Verify a code's signature and expiry, returning its claims — or `null` for
 * every failure mode. Callers map that single `null` onto one `invalid_grant`,
 * so a tampered code, an expired code and a garbage code are indistinguishable
 * from outside.
 */
function verifyAuthorizationCode(
  operatorToken: string,
  code: string,
  nowMs: number,
): AuthorizationCodePayload | null {
  const separator = code.lastIndexOf(".");
  if (separator <= 0) return null;
  const encodedPayload = code.slice(0, separator);
  const presentedSignature = code.slice(separator + 1);

  const expectedSignature = derive(operatorToken, encodedPayload);
  const presentedBuffer = Buffer.from(presentedSignature, "base64url");
  // Length check first: timingSafeEqual throws on mismatched sizes, and the
  // expected length (32 bytes) is public anyway.
  if (presentedBuffer.length !== expectedSignature.length) return null;
  if (!timingSafeEqual(expectedSignature, presentedBuffer)) return null;

  let payload: AuthorizationCodePayload;
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as AuthorizationCodePayload;
  } catch {
    return null;
  }
  if (typeof payload?.exp !== "number" || typeof payload.challenge !== "string") return null;
  if (payload.exp * 1000 <= nowMs) return null;
  return payload;
}

/** PKCE S256: the challenge is base64url(SHA-256(verifier)). */
function computeS256Challenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier, "utf8").digest("base64url");
}

/**
 * Escape text for interpolation into HTML.
 *
 * Applied to EVERY value that reaches the consent page. Those values come from
 * dynamic client registration and query strings — i.e. from whoever can reach
 * the port — so an unescaped one is stored XSS against the operator at the
 * exact moment they are typing their token into the page. Quotes are escaped
 * as well as angle brackets because most interpolations land in attribute
 * values; `'` and `` ` `` are covered too, so the helper is safe in
 * single-quoted attributes without the caller having to think about it.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/`/g, "&#96;");
}

/** Whether a redirect URI is one Charlotte will ever send a code to. */
function isAllowedRedirectUri(rawUri: unknown): rawUri is string {
  if (typeof rawUri !== "string" || rawUri.trim() === "") return false;
  let parsed: URL;
  try {
    parsed = new URL(rawUri);
  } catch {
    return false;
  }
  // RFC 6749 §3.1.2: the redirection endpoint URI must not include a fragment.
  if (parsed.hash !== "") return false;
  if (parsed.protocol === "https:") return true;
  // Plain http only for loopback, so a self-hoster can run the flow locally.
  return parsed.protocol === "http:" && LOOPBACK_HOSTNAMES.has(parsed.hostname);
}

/** Read a string field from a query/body bag, ignoring arrays and non-strings. */
function readStringField(source: Record<string, unknown>, name: string): string | undefined {
  const value = source[name];
  return typeof value === "string" ? value : undefined;
}

/** The authorize-request parameters, as they arrive from query or form body. */
type AuthorizeParameters = Record<(typeof AUTHORIZE_PARAMETER_NAMES)[number], string | undefined>;

function readAuthorizeParameters(source: Record<string, unknown>): AuthorizeParameters {
  const parameters = {} as AuthorizeParameters;
  for (const name of AUTHORIZE_PARAMETER_NAMES) {
    parameters[name] = readStringField(source, name);
  }
  return parameters;
}

/** Why an authorize request cannot be shown a consent page at all. */
function validateAuthorizeParameters(parameters: AuthorizeParameters): string | null {
  if (!isAllowedRedirectUri(parameters.redirect_uri)) {
    return "redirect_uri must be an absolute https URL (or http on localhost) with no fragment.";
  }
  if (parameters.response_type !== undefined && parameters.response_type !== "code") {
    return "Only the authorization code flow (response_type=code) is supported.";
  }
  if (parameters.code_challenge === undefined || parameters.code_challenge.trim() === "") {
    return "PKCE is required: send code_challenge with code_challenge_method=S256.";
  }
  // RFC 7636 defaults an absent method to "plain"; Charlotte advertises S256
  // only, so an absent method is read as S256 and "plain" is refused outright.
  if (
    parameters.code_challenge_method !== undefined &&
    parameters.code_challenge_method !== "S256"
  ) {
    return "Only code_challenge_method=S256 is supported.";
  }
  return null;
}

/** Shared page chrome. No script anywhere — the CSP below forbids it. */
function renderPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    margin: 0; padding: 2.5rem 1.25rem; display: flex; justify-content: center;
    background: Canvas; color: CanvasText;
  }
  main { width: 100%; max-width: 32rem; }
  h1 { font-size: 1.35rem; margin: 0 0 0.35rem; }
  p.lede { margin: 0 0 1.5rem; opacity: 0.75; }
  dl { margin: 0 0 1.5rem; padding: 0.9rem 1rem; border: 1px solid; border-color: color-mix(in srgb, CanvasText 20%, transparent); border-radius: 8px; }
  dt { font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.65; }
  dd { margin: 0.1rem 0 0.85rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85rem; word-break: break-all; }
  dd:last-of-type { margin-bottom: 0; }
  label { display: block; font-weight: 600; margin-bottom: 0.4rem; }
  input[type=password] { width: 100%; box-sizing: border-box; padding: 0.6rem 0.7rem; font: inherit; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; border: 1px solid; border-color: color-mix(in srgb, CanvasText 35%, transparent); border-radius: 6px; background: Canvas; color: CanvasText; }
  button { margin-top: 1rem; padding: 0.6rem 1.1rem; font: inherit; font-weight: 600; border: 0; border-radius: 6px; background: CanvasText; color: Canvas; cursor: pointer; }
  .error { margin: 0 0 1.25rem; padding: 0.7rem 0.9rem; border-radius: 6px; border: 1px solid #c0392b; color: #c0392b; }
  .hint { margin-top: 1.5rem; font-size: 0.85rem; opacity: 0.7; }
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

/** Inputs for the consent page. Every one of them is untrusted. */
interface ConsentPageParams {
  publicOrigin: string;
  parameters: AuthorizeParameters;
  errorMessage?: string;
}

function renderConsentPage({ publicOrigin, parameters, errorMessage }: ConsentPageParams): string {
  const hiddenFields = AUTHORIZE_PARAMETER_NAMES.filter(
    (name) => parameters[name] !== undefined,
  ).map(
    (name) =>
      `  <input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(parameters[name]!)}">`,
  );

  const body = `<h1>Authorize access to Charlotte</h1>
<p class="lede">A client is asking to drive this browser server at ${escapeHtml(publicOrigin)}.</p>
${errorMessage ? `<p class="error">${escapeHtml(errorMessage)}</p>` : ""}
<dl>
  <dt>Client ID</dt>
  <dd>${escapeHtml(parameters.client_id ?? "(not supplied)")}</dd>
  <dt>Redirect URI</dt>
  <dd>${escapeHtml(parameters.redirect_uri ?? "")}</dd>
</dl>
<form method="post" action="/oauth/authorize" autocomplete="off">
${hiddenFields.join("\n")}
  <label for="operator-token">Charlotte auth token</label>
  <input id="operator-token" type="password" name="operator_token" required
         autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
  <button type="submit">Approve</button>
</form>
<p class="hint">This is the token from <code>CHARLOTTE_AUTH_TOKEN</code>. Approving grants
this client the same access you have; rotate the token to revoke it.</p>`;

  return renderPage("Authorize Charlotte", body);
}

function renderErrorPage(message: string): string {
  return renderPage(
    "Charlotte — request rejected",
    `<h1>Request rejected</h1>
<p class="error">${escapeHtml(message)}</p>
<p class="hint">No authorization was granted. Close this window and try again from the client.</p>`,
  );
}

/** Send an HTML page with the facade's standard no-cache / no-script headers. */
function sendHtml(res: Response, status: number, html: string): void {
  res
    .status(status)
    .set({
      "content-type": "text/html; charset=utf-8",
      // The consent form must never be cached or reconstructed from history.
      "cache-control": "no-store",
      // The page carries no script and loads nothing; say so, so an injected
      // string could not execute even if the escaping above were defeated.
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
      "referrer-policy": "no-referrer",
      "x-frame-options": "DENY",
    })
    .send(html);
}

/** Send a standard OAuth error object (RFC 6749 §5.2 shape). */
function sendOauthError(
  res: Response,
  status: number,
  error: string,
  errorDescription?: string,
): void {
  const body: Record<string, string> = { error };
  if (errorDescription !== undefined) body.error_description = errorDescription;
  res.status(status).set("cache-control", "no-store").json(body);
}

/**
 * Mount the facade's routes on an existing Express app.
 *
 * Everything lives on one router so the transport's own wiring stays a single
 * call, and so route ordering inside the facade is decided here rather than
 * being interleaved with `/mcp` and the catch-all. The router matches only its
 * own paths and calls `next()` otherwise, so the catch-all 404 still owns
 * every path neither it nor the transport serves.
 */
export function mountOauthFacade(
  app: express.Application,
  options: OauthFacadeOptions,
): OauthFacadeHandle {
  const { publicOrigin, operatorToken } = options;
  const accessToken = deriveAccessToken(operatorToken);
  const isOperatorToken = makeSecretMatcher([operatorToken]);
  const router = Router();

  // Body parsers are route-scoped on purpose. A global parser would drain the
  // request stream that `toNodeHandler` reads for itself on /mcp.
  const jsonBody = express.json({ limit: BODY_SIZE_LIMIT });
  const formBody = express.urlencoded({ extended: false, limit: BODY_SIZE_LIMIT });

  // ─── RFC 9728: protected-resource metadata ───
  // Served at both the path-scoped and root locations: Session A showed
  // claude.ai probing `/.well-known/oauth-protected-resource/mcp` first and
  // falling back to the bare path.
  const protectedResourceMetadata = {
    resource: `${publicOrigin}/mcp`,
    authorization_servers: [publicOrigin],
  };
  const sendMetadata = (payload: unknown) => (_req: Request, res: Response) => {
    // Metadata is public by definition (RFC 9728 §3) — no auth, and CORS-open
    // so a browser-based client can read it.
    res.set("access-control-allow-origin", "*").json(payload);
  };
  router.get("/.well-known/oauth-protected-resource", sendMetadata(protectedResourceMetadata));
  router.get("/.well-known/oauth-protected-resource/mcp", sendMetadata(protectedResourceMetadata));

  // ─── RFC 8414: authorization-server metadata ───
  // A public client with PKCE: no client secret is ever issued, so the token
  // endpoint's auth method is "none" and S256 is the only challenge method.
  router.get(
    "/.well-known/oauth-authorization-server",
    sendMetadata({
      issuer: publicOrigin,
      authorization_endpoint: `${publicOrigin}/oauth/authorize`,
      token_endpoint: `${publicOrigin}/oauth/token`,
      registration_endpoint: `${publicOrigin}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    }),
  );

  // ─── RFC 7591: dynamic client registration ───
  // Accept-and-echo. There is no client database: the id is an HMAC tag over
  // the redirect URIs, which makes re-registration idempotent and means a
  // forged id buys nothing (the operator's consent, not the id, is the gate).
  const handleRegister = (req: Request, res: Response): void => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const redirectUris = body.redirect_uris;
    if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
      sendOauthError(res, 400, "invalid_client_metadata", "redirect_uris is required.");
      return;
    }
    if (!redirectUris.every((uri) => isAllowedRedirectUri(uri))) {
      sendOauthError(
        res,
        400,
        "invalid_redirect_uri",
        "Redirect URIs must be absolute https URLs (or http on localhost) with no fragment.",
      );
      return;
    }

    const uris = redirectUris as string[];
    res
      .status(201)
      .set("cache-control", "no-store")
      .json({
        client_id: deriveClientId(operatorToken, uris),
        client_id_issued_at: Math.floor(Date.now() / 1000),
        redirect_uris: uris,
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        ...(typeof body.client_name === "string" ? { client_name: body.client_name } : {}),
      });
  };
  router.post("/oauth/register", jsonBody, handleRegister);
  // Observed default probe path — claude.ai tries it unprompted, before it has
  // read any metadata document.
  router.post("/register", jsonBody, handleRegister);

  // ─── Consent (GET renders, POST decides) ───
  router.get("/oauth/authorize", (req: Request, res: Response) => {
    const parameters = readAuthorizeParameters(req.query as Record<string, unknown>);
    const problem = validateAuthorizeParameters(parameters);
    if (problem !== null) {
      // No error redirect: the request never proved which redirect URI it is
      // allowed to reach, and an unvalidated one is an open redirector.
      sendHtml(res, 400, renderErrorPage(problem));
      return;
    }
    sendHtml(res, 200, renderConsentPage({ publicOrigin, parameters }));
  });

  router.post("/oauth/authorize", formBody, (req: Request, res: Response) => {
    // Hidden form fields are no more trusted than query parameters — they made
    // the same round trip through the client's browser, so validate again.
    const parameters = readAuthorizeParameters((req.body ?? {}) as Record<string, unknown>);
    const problem = validateAuthorizeParameters(parameters);
    if (problem !== null) {
      sendHtml(res, 400, renderErrorPage(problem));
      return;
    }

    const presentedToken = readStringField(
      (req.body ?? {}) as Record<string, unknown>,
      "operator_token",
    );
    if (!isOperatorToken(presentedToken)) {
      // Re-render, never redirect. An OAuth error redirect here would turn the
      // consent form into an oracle for guessing the operator token, and the
      // client has no business learning that a human typed the wrong password.
      sendHtml(
        res,
        401,
        renderConsentPage({
          publicOrigin,
          parameters,
          errorMessage: "That token is not correct. Nothing was authorized.",
        }),
      );
      return;
    }

    const code = mintAuthorizationCode({
      operatorToken,
      clientId: parameters.client_id ?? "",
      redirectUri: parameters.redirect_uri!,
      challenge: parameters.code_challenge!,
    });
    const redirectTarget = new URL(parameters.redirect_uri!);
    redirectTarget.searchParams.set("code", code);
    if (parameters.state !== undefined) {
      redirectTarget.searchParams.set("state", parameters.state);
    }
    res.set("cache-control", "no-store").redirect(302, redirectTarget.toString());
  });

  // ─── Token exchange ───
  // Accepts form-encoded (the RFC 6749 wire format) and JSON, because clients
  // in the wild send both.
  router.post("/oauth/token", formBody, jsonBody, (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const grantType = readStringField(body, "grant_type");
    if (grantType !== "authorization_code") {
      sendOauthError(res, 400, "unsupported_grant_type", "Only authorization_code is supported.");
      return;
    }

    const code = readStringField(body, "code");
    const codeVerifier = readStringField(body, "code_verifier");
    const redirectUri = readStringField(body, "redirect_uri");
    const clientId = readStringField(body, "client_id");
    if (
      code === undefined ||
      codeVerifier === undefined ||
      redirectUri === undefined ||
      clientId === undefined
    ) {
      sendOauthError(
        res,
        400,
        "invalid_request",
        "code, code_verifier, redirect_uri and client_id are all required.",
      );
      return;
    }

    // Every failure below answers with the same bare `invalid_grant`: a
    // tampered signature, an expired code, the wrong verifier and a swapped
    // redirect URI are one indistinguishable outcome from the client's side.
    const payload = verifyAuthorizationCode(operatorToken, code, Date.now());
    if (payload === null) {
      sendOauthError(res, 400, "invalid_grant");
      return;
    }
    const claimsMatch = makeSecretMatcher([
      `${payload.client_id}\n${payload.redirect_uri_hash}\n${payload.challenge}`,
    ]);
    if (
      !claimsMatch(
        `${clientId}\n${hashRedirectUri(operatorToken, redirectUri)}\n${computeS256Challenge(codeVerifier)}`,
      )
    ) {
      sendOauthError(res, 400, "invalid_grant");
      return;
    }

    res.set("cache-control", "no-store").json({
      access_token: accessToken,
      token_type: "Bearer",
    });
  });

  // ─── Error handler, last on the router (4-arg signature is how Express
  // recognizes one) ───
  // Body parsers reject malformed JSON and oversized payloads by calling
  // next(error). Without this, Express's default handler answers with an HTML
  // page carrying a stack trace — filesystem paths and all — to an
  // unauthenticated caller. Everything becomes a standard OAuth error instead.
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = (error as { status?: number } | null)?.status ?? 500;
    if (status >= 500) {
      logger.error("OAuth facade error", error instanceof Error ? error : new Error(String(error)));
      sendOauthError(res, 500, "server_error");
      return;
    }
    sendOauthError(res, status, "invalid_request", "The request body could not be read.");
  });

  app.use(router);

  return {
    accessToken,
    protectedResourceMetadataUrl: `${publicOrigin}/.well-known/oauth-protected-resource`,
  };
}
