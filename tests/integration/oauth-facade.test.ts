import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  setupUnlaunchedHttpHarness,
  readJsonRpc,
  type HttpHarness,
} from "../helpers/http-harness.js";
import { pollUntil } from "../helpers/poll.js";
import { deriveAccessToken, mintAuthorizationCode } from "../../src/transports/oauth-facade.js";

/**
 * OAuth facade — slice 1 step 4a (docs/remote/oauth-facade-design.md).
 *
 * Covers the I4a–I4d assertion family plus the happy path a connector client
 * actually walks: discovery → dynamic client registration → consent →
 * token exchange → an authenticated `tools/list`.
 *
 * The harness is deliberately the **unlaunched** one. Two reasons:
 *
 *  - I4a says the entire OAuth dance touches neither browser nor session. With
 *    a pre-launched Chromium `isConnected()` would be true no matter what the
 *    facade did, and the assertion would prove nothing.
 *  - Nothing in the flow needs a page, so requiring one would hide a regression
 *    where an endpoint started rendering.
 *
 * `PUBLIC_ORIGIN` is metadata only — the facade never dials it — so an
 * https origin that resolves nowhere is exactly right while the harness itself
 * listens on http loopback.
 */

const PUBLIC_ORIGIN = "https://charlotte.test";
const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";
const PKCE_VERIFIER = "6bd6f2a5-8bd6-4f4e-9a2f-charlotte-verifier-0123456789";
const PKCE_CHALLENGE = createHash("sha256").update(PKCE_VERIFIER, "utf8").digest("base64url");

/** Everything about the session the OAuth dance must not be able to move (I4a). */
interface SessionFingerprint {
  browserConnected: boolean;
  hasPages: boolean;
  snapshotCount: number;
  latestSnapshotId: number;
}

function fingerprintSession(harness: HttpHarness): SessionFingerprint {
  return {
    browserConnected: harness.browserManager.isConnected(),
    hasPages: harness.pageManager.hasPages(),
    snapshotCount: harness.snapshotStore.size,
    latestSnapshotId: harness.snapshotStore.getLatestId(),
  };
}

const COLD_BASELINE: SessionFingerprint = {
  browserConnected: false,
  hasPages: false,
  snapshotCount: 0,
  latestSnapshotId: 0,
};

describe("OAuth facade (slice 1 step 4a)", () => {
  let harness: HttpHarness;
  let baseUrl: string;

  const getJson = async (path: string): Promise<{ status: number; body: unknown }> => {
    const response = await fetch(`${baseUrl}${path}`);
    return { status: response.status, body: await response.json() };
  };

  const postForm = (path: string, fields: Record<string, string>): Promise<Response> =>
    fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
      // Manual: the 302's Location IS the assertion, and following it would
      // send the harness off to the real claude.ai.
      redirect: "manual",
    });

  const postJson = (path: string, body: unknown): Promise<Response> =>
    fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  /** Authorize-request parameters a well-behaved client would send. */
  const authorizeQuery = (overrides: Record<string, string> = {}): Record<string, string> => ({
    response_type: "code",
    client_id: registeredClientId,
    redirect_uri: REDIRECT_URI,
    state: "state-abc123",
    code_challenge: PKCE_CHALLENGE,
    code_challenge_method: "S256",
    ...overrides,
  });

  /** Fresh, valid code for the negative token-exchange cases to mutate. */
  const mintValidCode = async (): Promise<string> => {
    const response = await postForm("/oauth/authorize", {
      ...authorizeQuery(),
      operator_token: harness.authToken,
    });
    expect(response.status).toBe(302);
    return new URL(response.headers.get("location")!).searchParams.get("code")!;
  };

  let registeredClientId = "";
  let issuedAccessToken = "";

  beforeAll(async () => {
    harness = await setupUnlaunchedHttpHarness({ publicOrigin: PUBLIC_ORIGIN });
    baseUrl = harness.baseUrl;
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  describe("discovery", () => {
    const PROTECTED_RESOURCE_METADATA = {
      resource: `${PUBLIC_ORIGIN}/mcp`,
      authorization_servers: [PUBLIC_ORIGIN],
    };

    it("serves RFC 9728 protected-resource metadata at the path-scoped location", async () => {
      // The location claude.ai probes FIRST (Session A, 2026-08-02).
      const { status, body } = await getJson("/.well-known/oauth-protected-resource/mcp");
      expect(status).toBe(200);
      expect(body).toEqual(PROTECTED_RESOURCE_METADATA);
    });

    it("serves the same document at the root fallback location", async () => {
      const { status, body } = await getJson("/.well-known/oauth-protected-resource");
      expect(status).toBe(200);
      expect(body).toEqual(PROTECTED_RESOURCE_METADATA);
    });

    it("serves RFC 8414 authorization-server metadata for a public PKCE client", async () => {
      const { status, body } = await getJson("/.well-known/oauth-authorization-server");
      expect(status).toBe(200);
      // Pinned in full: these are the URLs a client stores, and every one of
      // them must be built from the PUBLIC origin, not the bind address.
      expect(body).toEqual({
        issuer: PUBLIC_ORIGIN,
        authorization_endpoint: `${PUBLIC_ORIGIN}/oauth/authorize`,
        token_endpoint: `${PUBLIC_ORIGIN}/oauth/token`,
        registration_endpoint: `${PUBLIC_ORIGIN}/oauth/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    });

    it("leaves unrelated paths to the catch-all 404", async () => {
      const { status, body } = await getJson("/oauth/definitely-not-a-route");
      expect(status).toBe(404);
      expect(body).toEqual({ error: "not_found" });
    });
  });

  describe("dynamic client registration (RFC 7591)", () => {
    it("registers a client and returns a public-client record", async () => {
      const response = await postJson("/oauth/register", {
        redirect_uris: [REDIRECT_URI],
        client_name: "Claude",
      });
      expect(response.status).toBe(201);

      const body = (await response.json()) as Record<string, unknown>;
      expect(typeof body.client_id).toBe("string");
      expect(body.redirect_uris).toEqual([REDIRECT_URI]);
      expect(body.token_endpoint_auth_method).toBe("none");
      expect(body.grant_types).toEqual(["authorization_code"]);
      expect(body.response_types).toEqual(["code"]);
      expect(body.client_name).toBe("Claude");
      // A public client: no secret is minted, so none can leak.
      expect(body).not.toHaveProperty("client_secret");

      registeredClientId = body.client_id as string;
    });

    it("derives the same client_id for the same redirect_uris (stateless, restart-proof)", async () => {
      const response = await postJson("/oauth/register", { redirect_uris: [REDIRECT_URI] });
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.client_id).toBe(registeredClientId);
    });

    it("derives a different client_id for different redirect_uris", async () => {
      const response = await postJson("/oauth/register", {
        redirect_uris: ["https://example.com/other-callback"],
      });
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.client_id).not.toBe(registeredClientId);
    });

    it("answers the observed default probe path /register with the same handler", async () => {
      // claude.ai POSTs here unprompted, before reading any metadata document.
      const response = await postJson("/register", { redirect_uris: [REDIRECT_URI] });
      expect(response.status).toBe(201);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.client_id).toBe(registeredClientId);
    });

    it("rejects a plain-http redirect URI", async () => {
      const response = await postJson("/oauth/register", {
        redirect_uris: ["http://evil.example.com/callback"],
      });
      expect(response.status).toBe(400);
      expect((await response.json()) as Record<string, unknown>).toMatchObject({
        error: "invalid_redirect_uri",
      });
    });

    it("allows http on loopback so a self-hoster can test locally", async () => {
      const response = await postJson("/oauth/register", {
        redirect_uris: ["http://localhost:9876/callback"],
      });
      expect(response.status).toBe(201);
    });

    it("answers a malformed JSON body with an OAuth error, not a stack trace", async () => {
      const response = await fetch(`${baseUrl}/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"redirect_uris":',
      });
      expect(response.status).toBe(400);
      // Express's default error handler would send an HTML page with the
      // server's filesystem paths in it, to an unauthenticated caller.
      expect(response.headers.get("content-type")).toContain("application/json");
      expect((await response.json()) as Record<string, unknown>).toMatchObject({
        error: "invalid_request",
      });
    });

    it("rejects a registration with no redirect_uris at all", async () => {
      const response = await postJson("/oauth/register", { client_name: "no-uris" });
      expect(response.status).toBe(400);
      expect((await response.json()) as Record<string, unknown>).toMatchObject({
        error: "invalid_client_metadata",
      });
    });
  });

  describe("consent page (GET /oauth/authorize)", () => {
    it("renders a form posting back to the authorize endpoint", async () => {
      const response = await fetch(
        `${baseUrl}/oauth/authorize?${new URLSearchParams(authorizeQuery()).toString()}`,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(response.headers.get("cache-control")).toContain("no-store");

      const html = await response.text();
      expect(html).toContain('method="post"');
      expect(html).toContain('action="/oauth/authorize"');
      expect(html).toContain('name="operator_token"');
      expect(html).toContain('type="password"');
      // The one field a browser must never remember or offer to fill.
      expect(html).toMatch(/name="operator_token"[\s\S]*?autocomplete="off"/);
      // Every authorize parameter round-trips, or the POST would lose the PKCE
      // binding and the client's state.
      expect(html).toContain(`value="${PKCE_CHALLENGE}"`);
      expect(html).toContain('value="state-abc123"');
      expect(html).toContain(REDIRECT_URI);
    });

    it("escapes reflected client-supplied values instead of rendering them", async () => {
      // A DCR client picks its own client_id echo and query values; this one is
      // hostile. Note the moment of exposure: the operator is about to type the
      // root credential into this exact page.
      const hostileClientId = '"><script>alert(1)</script>';
      const response = await fetch(
        `${baseUrl}/oauth/authorize?${new URLSearchParams(
          authorizeQuery({ client_id: hostileClientId, state: "</textarea><img src=x onerror=1>" }),
        ).toString()}`,
      );
      expect(response.status).toBe(200);

      const html = await response.text();
      expect(html).not.toContain("<script>alert(1)</script>");
      expect(html).not.toContain("<img src=x");
      expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      // The attribute-breaking quote is escaped too, so the hidden input keeps
      // its shape.
      expect(html).toContain("&quot;&gt;&lt;script&gt;");
      // Belt and braces: the page declares that no script may run at all.
      expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    });

    it("refuses a non-https redirect URI with an error page, not a redirect", async () => {
      const response = await fetch(
        `${baseUrl}/oauth/authorize?${new URLSearchParams(
          authorizeQuery({ redirect_uri: "http://evil.example.com/callback" }),
        ).toString()}`,
        { redirect: "manual" },
      );
      expect(response.status).toBe(400);
      // No error redirect: an unvalidated redirect_uri would make this an open
      // redirector for anyone who can reach the port.
      expect(response.headers.get("location")).toBeNull();
      expect(await response.text()).toContain("Request rejected");
    });

    it("requires PKCE with S256", async () => {
      const missing = await fetch(
        `${baseUrl}/oauth/authorize?${new URLSearchParams(
          Object.fromEntries(
            Object.entries(authorizeQuery()).filter(([key]) => key !== "code_challenge"),
          ) as Record<string, string>,
        ).toString()}`,
      );
      expect(missing.status).toBe(400);

      const plain = await fetch(
        `${baseUrl}/oauth/authorize?${new URLSearchParams(
          authorizeQuery({ code_challenge_method: "plain" }),
        ).toString()}`,
      );
      expect(plain.status).toBe(400);
      expect(await plain.text()).toContain("S256");
    });
  });

  describe("consent decision (POST /oauth/authorize)", () => {
    it("I4d: a wrong operator token re-renders the form and issues no code", async () => {
      const response = await postForm("/oauth/authorize", {
        ...authorizeQuery(),
        operator_token: "not-the-operator-token",
      });

      expect(response.status).toBe(401);
      expect(response.headers.get("location")).toBeNull();
      const html = await response.text();
      // Re-rendered, not redirected: the client learns nothing, and the
      // operator gets another try without restarting the flow.
      expect(html).toContain('name="operator_token"');
      expect(html).toContain("Nothing was authorized");
      expect(html).toContain(`value="${PKCE_CHALLENGE}"`);
      expect(html).not.toContain("code=");
    });

    it("redirects to the registered redirect URI with code and state on success", async () => {
      const response = await postForm("/oauth/authorize", {
        ...authorizeQuery(),
        operator_token: harness.authToken,
      });

      expect(response.status).toBe(302);
      const location = new URL(response.headers.get("location")!);
      expect(`${location.origin}${location.pathname}`).toBe(REDIRECT_URI);
      expect(location.searchParams.get("state")).toBe("state-abc123");
      const code = location.searchParams.get("code");
      expect(code).toBeTruthy();
      // A signed blob, not an opaque handle to server state.
      expect(code).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      // The credential must not ride along in the redirect.
      expect(response.headers.get("location")).not.toContain(harness.authToken);
    });

    it("re-validates the redirect URI from the form body, not just the query", async () => {
      // Hidden fields made the same round trip through the client's browser.
      const response = await postForm("/oauth/authorize", {
        ...authorizeQuery({ redirect_uri: "http://evil.example.com/callback" }),
        operator_token: harness.authToken,
      });
      expect(response.status).toBe(400);
      expect(response.headers.get("location")).toBeNull();
    });
  });

  describe("token exchange (POST /oauth/token)", () => {
    it("exchanges a code + verifier for a bearer token", async () => {
      const code = await mintValidCode();
      const response = await postForm("/oauth/token", {
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: registeredClientId,
        code_verifier: PKCE_VERIFIER,
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      const body = (await response.json()) as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(["access_token", "token_type"]);
      expect(body.token_type).toBe("Bearer");
      expect(typeof body.access_token).toBe("string");
      // Distinguishable from the operator token in a log, and never equal to it.
      expect(body.access_token as string).toMatch(/^charlotte_at_[0-9a-f]{64}$/);
      expect(body.access_token).not.toBe(harness.authToken);

      issuedAccessToken = body.access_token as string;
    });

    it("is deterministic: the same operator token always mints the same access token", async () => {
      const code = await mintValidCode();
      const response = await postForm("/oauth/token", {
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: registeredClientId,
        code_verifier: PKCE_VERIFIER,
      });
      const body = (await response.json()) as Record<string, unknown>;
      // Which is what makes the stored credential survive a restart.
      expect(body.access_token).toBe(issuedAccessToken);
    });

    it("accepts a JSON body as well as form encoding", async () => {
      const code = await mintValidCode();
      const response = await postJson("/oauth/token", {
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: registeredClientId,
        code_verifier: PKCE_VERIFIER,
      });
      expect(response.status).toBe(200);
      expect((await response.json()) as Record<string, unknown>).toMatchObject({
        access_token: issuedAccessToken,
      });
    });

    describe("I4b: rejections carry standard OAuth errors and nothing else", () => {
      it("rejects an unsupported grant type", async () => {
        const response = await postForm("/oauth/token", {
          grant_type: "client_credentials",
          client_id: registeredClientId,
        });
        expect(response.status).toBe(400);
        expect((await response.json()) as Record<string, unknown>).toMatchObject({
          error: "unsupported_grant_type",
        });
      });

      it("rejects a request missing required parameters", async () => {
        const response = await postForm("/oauth/token", {
          grant_type: "authorization_code",
          code: await mintValidCode(),
        });
        expect(response.status).toBe(400);
        expect((await response.json()) as Record<string, unknown>).toMatchObject({
          error: "invalid_request",
        });
      });

      it("rejects a tampered code signature", async () => {
        const code = await mintValidCode();
        const [payload, signature] = code.split(".");
        const tampered = `${payload}.${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;

        const response = await postForm("/oauth/token", {
          grant_type: "authorization_code",
          code: tampered,
          redirect_uri: REDIRECT_URI,
          client_id: registeredClientId,
          code_verifier: PKCE_VERIFIER,
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "invalid_grant" });
      });

      it("rejects a tampered code payload (expiry pushed out)", async () => {
        const code = await mintValidCode();
        const [payload, signature] = code.split(".");
        const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
          exp: number;
        };
        claims.exp += 86_400;
        const forged = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");

        const response = await postForm("/oauth/token", {
          grant_type: "authorization_code",
          code: `${forged}.${signature}`,
          redirect_uri: REDIRECT_URI,
          client_id: registeredClientId,
          code_verifier: PKCE_VERIFIER,
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "invalid_grant" });
      });

      it("rejects an expired code", async () => {
        // Minted directly with a past expiry rather than through a clock seam
        // in the request path: verification always reads the real Date.now(),
        // so there is no test-only branch in production code.
        const expiredCode = mintAuthorizationCode({
          operatorToken: harness.authToken,
          clientId: registeredClientId,
          redirectUri: REDIRECT_URI,
          challenge: PKCE_CHALLENGE,
          expiresAtMs: Date.now() - 1_000,
        });

        const response = await postForm("/oauth/token", {
          grant_type: "authorization_code",
          code: expiredCode,
          redirect_uri: REDIRECT_URI,
          client_id: registeredClientId,
          code_verifier: PKCE_VERIFIER,
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "invalid_grant" });
      });

      it("rejects the wrong PKCE verifier", async () => {
        const code = await mintValidCode();
        const response = await postForm("/oauth/token", {
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT_URI,
          client_id: registeredClientId,
          code_verifier: `${PKCE_VERIFIER}-wrong`,
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "invalid_grant" });
      });

      it("rejects a mismatched redirect URI", async () => {
        const code = await mintValidCode();
        const response = await postForm("/oauth/token", {
          grant_type: "authorization_code",
          code,
          redirect_uri: "https://claude.ai/api/mcp/other_callback",
          client_id: registeredClientId,
          code_verifier: PKCE_VERIFIER,
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "invalid_grant" });
      });

      it("rejects a mismatched client id", async () => {
        const code = await mintValidCode();
        const response = await postForm("/oauth/token", {
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT_URI,
          client_id: "charlotte-client-someone-else",
          code_verifier: PKCE_VERIFIER,
        });
        expect(response.status).toBe(400);
        // Byte-identical to every other grant failure: the client cannot tell
        // which of its parameters was wrong.
        expect(await response.json()).toEqual({ error: "invalid_grant" });
      });
    });
  });

  describe("I4c: /mcp accepts both credentials", () => {
    const toolsList = { jsonrpc: "2.0" as const, id: 1, method: "tools/list", params: {} };

    const callMcp = (token: string | null): Promise<Response> =>
      fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(token === null ? {} : { authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify(toolsList),
      });

    it("serves tools/list with the derived access token", async () => {
      expect(issuedAccessToken).not.toBe("");
      const response = await callMcp(issuedAccessToken);
      expect(response.status).toBe(200);

      const message = await readJsonRpc(response);
      expect(message.error).toBeUndefined();
      expect((message.result?.tools as Array<{ name: string }>).length).toBeGreaterThan(0);
    });

    it("still serves tools/list with the operator token", async () => {
      const response = await callMcp(harness.authToken);
      expect(response.status).toBe(200);
      expect((await readJsonRpc(response)).error).toBeUndefined();
    });

    it("rejects anything else, with a WWW-Authenticate pointing at the metadata", async () => {
      const response = await callMcp("charlotte_at_deadbeef");
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
      expect(response.headers.get("www-authenticate")).toBe(
        `Bearer resource_metadata="${PUBLIC_ORIGIN}/.well-known/oauth-protected-resource"`,
      );
    });

    it("challenges a request with no Authorization header at all", async () => {
      const response = await callMcp(null);
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain("resource_metadata=");
    });
  });

  describe("I4a: the whole OAuth dance never touches the browser or session", () => {
    it("ends where it started: no browser, no pages, no snapshots", () => {
      // Discovery, two registrations, several consent renders, a successful
      // approval and eight token exchanges have run above this line.
      expect(fingerprintSession(harness)).toEqual(COLD_BASELINE);
    });

    it("stays cold through a fresh end-to-end flow", async () => {
      const registration = await postJson("/oauth/register", { redirect_uris: [REDIRECT_URI] });
      const clientId = ((await registration.json()) as Record<string, unknown>).client_id as string;

      const consent = await fetch(
        `${baseUrl}/oauth/authorize?${new URLSearchParams(
          authorizeQuery({ client_id: clientId }),
        ).toString()}`,
      );
      expect(consent.status).toBe(200);

      const approval = await postForm("/oauth/authorize", {
        ...authorizeQuery({ client_id: clientId }),
        operator_token: harness.authToken,
      });
      const code = new URL(approval.headers.get("location")!).searchParams.get("code")!;

      const token = await postForm("/oauth/token", {
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: clientId,
        code_verifier: PKCE_VERIFIER,
      });
      expect(token.status).toBe(200);

      expect(fingerprintSession(harness)).toEqual(COLD_BASELINE);
    });
  });
});

describe("OAuth facade off (no publicOrigin) — today's bearer-only behavior", () => {
  let harness: HttpHarness;

  beforeAll(async () => {
    harness = await setupUnlaunchedHttpHarness();
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  it.each([
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
    "/.well-known/oauth-authorization-server",
    "/oauth/authorize",
  ])("404s %s through the existing catch-all", async (path) => {
    const response = await fetch(`${harness.baseUrl}${path}`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it.each(["/oauth/register", "/register", "/oauth/token"])(
    "404s POST %s through the existing catch-all",
    async (path) => {
      const response = await fetch(`${harness.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }),
      });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    },
  );

  it("answers the /mcp 401 with no WWW-Authenticate header", async () => {
    const response = await fetch(`${harness.baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    // Advertising a resource_metadata URL that 404s would be worse than silence.
    expect(response.headers.get("www-authenticate")).toBeNull();
  });

  it("rejects a token that a facade-enabled server would have derived", async () => {
    const response = await fetch(`${harness.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        // Same operator token, same derivation — but with the facade off the
        // derived credential is not an accepted one.
        authorization: `Bearer ${deriveAccessToken(harness.authToken)}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(response.status).toBe(401);
  });
});

describe("observation mode never logs the consent form's body", () => {
  let harness: HttpHarness;

  beforeAll(async () => {
    harness = await setupUnlaunchedHttpHarness({
      publicOrigin: PUBLIC_ORIGIN,
      debugRequests: true,
    });
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  it("logs the request line but not the operator token in the POST body", async () => {
    // The one place the root credential travels in a request BODY. The
    // observation middleware logs method, path and redacted headers only —
    // this pins that, because a log file shared for diagnostics would
    // otherwise be a copy of the server's master key.
    const chunks: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stderr.write);

    try {
      const response = await fetch(`${harness.baseUrl}/oauth/authorize`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          response_type: "code",
          client_id: "charlotte-client-observation",
          redirect_uri: REDIRECT_URI,
          code_challenge: PKCE_CHALLENGE,
          code_challenge_method: "S256",
          operator_token: harness.authToken,
        }).toString(),
        redirect: "manual",
      });
      expect(response.status).toBe(302);
      await pollUntil(() => chunks.join("").includes("http response"), {
        timeout: 2000,
        message: "no response log line for the consent POST",
      });
    } finally {
      spy.mockRestore();
    }

    const logged = chunks.join("");
    expect(logged).toContain("/oauth/authorize");
    expect(logged).not.toContain(harness.authToken);
    expect(logged).not.toContain("operator_token");
  });
});

describe("publicOrigin validation", () => {
  it.each([
    ["not a URL", "charlotte.example.com"],
    ["plain http", "http://charlotte.example.com"],
    ["a path", "https://charlotte.example.com/mcp"],
    ["embedded credentials", "https://user:pass@charlotte.example.com"],
    ["a query string", "https://charlotte.example.com?x=1"],
  ])("refuses %s before the server binds", async (_label, origin) => {
    // Startup-time, not request-time: a mistyped origin would otherwise publish
    // metadata pointing somewhere else and fail days later at the client end.
    await expect(setupUnlaunchedHttpHarness({ publicOrigin: origin })).rejects.toThrow(
      /publicOrigin/,
    );
  });

  it("normalizes a trailing slash away", async () => {
    const harness = await setupUnlaunchedHttpHarness({
      publicOrigin: "https://charlotte.test/",
    });
    try {
      const response = await fetch(`${harness.baseUrl}/.well-known/oauth-protected-resource`);
      // Not "https://charlotte.test//mcp".
      expect(await response.json()).toEqual({
        resource: "https://charlotte.test/mcp",
        authorization_servers: ["https://charlotte.test"],
      });
    } finally {
      await harness.teardown();
    }
  });
});
