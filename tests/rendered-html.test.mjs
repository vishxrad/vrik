import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

async function waitForPage(url, processExited) {
  const deadline = Date.now() + 20_000;
  let lastError;

  while (Date.now() < deadline) {
    if (processExited.value) {
      throw new Error(`Next.js exited before becoming ready:\n${processExited.output}`);
    }

    try {
      const response = await fetch(url);
      if (response.status < 500) return response;
      lastError = new Error(`Server returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw lastError ?? new Error("Timed out waiting for Next.js");
}

test("serves the delivery partner interface at the root route", { timeout: 30_000 }, async (t) => {
  const port = await availablePort();
  const processExited = { value: false, output: "" };
  const nextProcess = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: projectRoot,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
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

  const response = await waitForPage(`http://127.0.0.1:${port}/`, processExited);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /Zomato Delivery Partner Demo/i);
  assert.match(html, /Current order/i);
  assert.match(html, /Empire Restaurant/i);
  assert.match(html, /Translate/i);
  assert.doesNotMatch(html, /codex-preview/i);
});
