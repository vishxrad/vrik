import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer as createNetServer } from "node:net";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

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

async function startNextServer(t) {
  const port = await availablePort();
  const processExited = { value: false, output: "" };
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
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
        CALLBACK_WEBHOOK_SECRET: "test-webhook-secret",
        DATABASE_URL: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
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
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (processExited.value) {
      throw new Error(`Next.js exited before becoming ready:\n${processExited.output}`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.status < 500) return baseUrl;
    } catch {
      // Retry while the production server starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for Next.js");
}

function intake(baseUrl, body, secret = "test-webhook-secret") {
  return fetch(`${baseUrl}/api/support/callbacks/intake`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

const validPayload = {
  callbackRequestId: "8d4c651e-e0f4-4c17-91d6-e6009ad482c8",
  riderId: "R-108",
  orderId: "4821",
  needsHuman: "escalated",
  issueType: "order_issue",
  priority: "high",
  summary: "Restaurant could not resolve the order handoff.",
};

test("Sarvam on-end callback intake validation", { timeout: 30_000 }, async (t) => {
  const baseUrl = await startNextServer(t);

  await t.test("accepts Sarvam escalation values and maps them before storage", async () => {
    const response = await intake(baseUrl, validPayload);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "DATABASE_NOT_CONFIGURED");
  });

  await t.test("ignores resolved calls without creating a callback", async () => {
    const response = await intake(baseUrl, {
      ...validPayload,
      needsHuman: "resolved",
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      accepted: false,
      reason: "human_callback_not_requested",
    });
  });

  await t.test("rejects invalid authentication and unsupported issue types", async () => {
    const unauthorized = await intake(baseUrl, validPayload, "wrong-secret");
    assert.equal(unauthorized.status, 401);
    assert.equal((await unauthorized.json()).error.code, "UNAUTHORIZED");

    const invalidIssue = await intake(baseUrl, {
      ...validPayload,
      issueType: "not_supported",
    });
    assert.equal(invalidIssue.status, 400);
    assert.equal((await invalidIssue.json()).error.code, "INVALID_REQUEST");
  });
});
