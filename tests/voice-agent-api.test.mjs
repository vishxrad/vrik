import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);
const orgId = "019fcdd6-892d-735d-9f7b-a3429296269b";
const workspaceId = "019fcdd6-8933-701b-a454-675ceb0e1ca4";
const appId = "Conversatio-bd183f33-9b95";

async function availablePort() {
  const server = createNetServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

async function waitForServer(url, processExited) {
  const deadline = Date.now() + 20_000;
  let lastError;

  while (Date.now() < deadline) {
    if (processExited.value) {
      throw new Error(`Next.js exited before becoming ready:\n${processExited.output}`);
    }

    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw lastError ?? new Error("Timed out waiting for Next.js");
}

async function startNextServer(t, environment = {}) {
  const port = await availablePort();
  const processExited = { value: false, output: "" };
  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1", ...environment };

  const nextProcess = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { cwd: projectRoot, env, stdio: ["ignore", "pipe", "pipe"] },
  );

  nextProcess.stdout.on("data", (chunk) => {
    processExited.output += chunk;
  });
  nextProcess.stderr.on("data", (chunk) => {
    processExited.output += chunk;
  });
  nextProcess.once("exit", () => {
    processExited.value = true;
  });

  t.after(() => {
    if (!processExited.value) nextProcess.kill("SIGTERM");
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(baseUrl, processExited);
  return baseUrl;
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

async function startMockSarvam(t) {
  const state = { mode: "ok", requests: [] };
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://sarvam.test");
    state.requests.push({
      method: request.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      apiKey: request.headers["x-api-key"],
    });

    if (state.mode === "timeout") {
      setTimeout(() => {
        if (!response.destroyed) {
          sendJson(response, 200, {
            url: "wss://voice.example.test/late",
            reference_id: "late-call",
          });
        }
      }, 250);
      return;
    }

    if (state.mode === "rate-limit") {
      sendJson(
        response,
        429,
        { error: { message: "busy" } },
        { "Retry-After": "7" },
      );
      return;
    }

    if (state.mode === "malformed") {
      sendJson(response, 200, { url: "missing-reference-id" });
      return;
    }

    sendJson(response, 200, {
      url: "wss://voice.example.test/session?token=short-lived",
      reference_id: "support-call-1",
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  t.after(() => server.close());

  return {
    state,
    url: `http://127.0.0.1:${address.port}`,
  };
}

function sessionUrl(baseUrl, overrides = {}) {
  const values = {
    orgId,
    workspaceId,
    appId,
    interactionType: "call",
    version: "2",
    ...overrides,
  };
  const url = new URL(
    `/api/voice-agent/orgs/${values.orgId}/workspaces/${values.workspaceId}/apps/${values.appId}/url`,
    baseUrl,
  );
  url.searchParams.set("interaction_type", values.interactionType);
  url.searchParams.set("version", values.version);
  url.searchParams.set("user_identifier", "untrusted-client-value");
  url.searchParams.set("user_identifier_type", "custom");
  return url;
}

async function errorBody(response) {
  return (await response.json()).error;
}

test("voice-agent session proxy", { timeout: 60_000 }, async (t) => {
  const mock = await startMockSarvam(t);
  const baseUrl = await startNextServer(t, {
    SARVAM_VOICE_AGENT_API_KEY: "voice-agent-secret",
    SARVAM_VOICE_AGENT_BASE_URL: mock.url,
    SARVAM_VOICE_AGENT_TIMEOUT_MS: "75",
  });

  await t.test("returns a short-lived URL without exposing the server key", async () => {
    const response = await fetch(sessionUrl(baseUrl), {
      headers: {
        "X-API-Key": "server-proxied",
        "X-Forwarded-For": "10.0.0.1",
      },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      url: "wss://voice.example.test/session?token=short-lived",
      reference_id: "support-call-1",
    });
    assert.deepEqual(mock.state.requests.at(-1), {
      method: "GET",
      path: `/orgs/${orgId}/workspaces/${workspaceId}/apps/${appId}/url`,
      query: {
        interaction_type: "call",
        version: "2",
        user_identifier: "rider-R-108",
        user_identifier_type: "custom",
      },
      apiKey: "voice-agent-secret",
    });
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  await t.test("rejects cross-origin and mismatched agent requests", async () => {
    const crossOrigin = await fetch(sessionUrl(baseUrl), {
      headers: {
        Origin: "https://attacker.example",
        "X-Forwarded-For": "10.0.0.2",
      },
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal((await errorBody(crossOrigin)).code, "CROSS_ORIGIN_REQUEST");

    const wrongAgent = await fetch(
      sessionUrl(baseUrl, { appId: "Conversatio-unknown" }),
      { headers: { "X-Forwarded-For": "10.0.0.2" } },
    );
    assert.equal(wrongAgent.status, 404);
    assert.equal((await errorBody(wrongAgent)).code, "AGENT_NOT_FOUND");

    const wrongVersion = await fetch(sessionUrl(baseUrl, { version: "3" }), {
      headers: { "X-Forwarded-For": "10.0.0.2" },
    });
    assert.equal(wrongVersion.status, 400);
    assert.equal((await errorBody(wrongVersion)).code, "INVALID_REQUEST");
  });

  await t.test("normalizes malformed, rate-limited, and timed-out upstreams", async () => {
    mock.state.mode = "malformed";
    const malformed = await fetch(sessionUrl(baseUrl), {
      headers: { "X-Forwarded-For": "10.0.0.3" },
    });
    assert.equal(malformed.status, 502);
    assert.equal((await errorBody(malformed)).code, "INVALID_SARVAM_RESPONSE");

    mock.state.mode = "rate-limit";
    const rateLimited = await fetch(sessionUrl(baseUrl), {
      headers: { "X-Forwarded-For": "10.0.0.4" },
    });
    assert.equal(rateLimited.status, 429);
    assert.equal(rateLimited.headers.get("retry-after"), "7");
    assert.equal((await errorBody(rateLimited)).code, "RATE_LIMITED");

    mock.state.mode = "timeout";
    const timedOut = await fetch(sessionUrl(baseUrl), {
      headers: { "X-Forwarded-For": "10.0.0.5" },
    });
    assert.equal(timedOut.status, 504);
    assert.equal((await errorBody(timedOut)).code, "SARVAM_TIMEOUT");
    mock.state.mode = "ok";
  });

  await t.test("rate-limits repeated session starts per rider IP", async () => {
    const address = "10.0.0.6";
    for (let index = 0; index < 8; index += 1) {
      const response = await fetch(sessionUrl(baseUrl), {
        headers: { "X-Forwarded-For": address },
      });
      assert.equal(response.status, 200);
    }

    const limited = await fetch(sessionUrl(baseUrl), {
      headers: { "X-Forwarded-For": address },
    });
    assert.equal(limited.status, 429);
    assert.equal((await errorBody(limited)).code, "RATE_LIMITED");
  });

  await t.test("reports a missing server credential", async (missingKeyTest) => {
    const noKeyBaseUrl = await startNextServer(missingKeyTest, {
      SARVAM_VOICE_AGENT_API_KEY: "",
      SARVAM_VOICE_AGENT_BASE_URL: mock.url,
    });
    const response = await fetch(sessionUrl(noKeyBaseUrl), {
      headers: { "X-Forwarded-For": "10.0.0.7" },
    });
    assert.equal(response.status, 503);
    assert.equal((await errorBody(response)).code, "SERVICE_NOT_CONFIGURED");
  });
});
