import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);
const fakeWav = Buffer.from("RIFF\u0024\u0000\u0000\u0000WAVEfmt data");

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
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete env[key];
  }

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

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

async function startMockSarvam(t) {
  const state = {
    mode: "ok",
    requests: [],
  };

  const server = createServer(async (request, response) => {
    const body = await requestBody(request);
    const url = new URL(request.url ?? "/", "http://sarvam.test");

    if (state.mode === "timeout") {
      setTimeout(() => {
        if (!response.destroyed) sendJson(response, 200, { transcript: "late" });
      }, 250);
      return;
    }

    if (state.mode === "rate-limit") {
      sendJson(
        response,
        429,
        { error: { message: "upstream rate limit" }, request_id: "req-rate" },
        { "Retry-After": "7" },
      );
      return;
    }

    if (state.mode === "malformed") {
      sendJson(response, 200, {});
      return;
    }

    if (url.pathname === "/speech-to-text") {
      const incoming = new Request(url, {
        method: "POST",
        headers: request.headers,
        body,
      });
      const form = await incoming.formData();
      const file = form.get("file");
      state.requests.push({
        path: url.pathname,
        apiKey: request.headers["api-subscription-key"],
        model: form.get("model"),
        mode: form.get("mode"),
        languageCode: form.get("language_code"),
        fileName: file instanceof File ? file.name : null,
        fileType: file instanceof File ? file.type : null,
      });
      sendJson(response, 200, {
        request_id: "req-stt",
        transcript: "வாசல் எண் இரண்டு",
        language_code: "ta-IN",
      });
      return;
    }

    const json = body.length ? JSON.parse(body.toString("utf8")) : null;
    state.requests.push({
      path: url.pathname,
      apiKey: request.headers["api-subscription-key"],
      json,
    });

    if (url.pathname === "/translate") {
      sendJson(response, 200, {
        request_id: "req-translate",
        translated_text: "गेट नंबर दो",
        source_language_code: "ta-IN",
      });
      return;
    }

    if (url.pathname === "/text-to-speech") {
      sendJson(response, 200, {
        request_id: "req-tts",
        audios: [fakeWav.toString("base64")],
      });
      return;
    }

    sendJson(response, 404, { error: { message: "not found" } });
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

function audioForm({
  languageCode = "ta-IN",
  type = "audio/webm;codecs=opus",
  bytes = Buffer.from("recorded-audio"),
} = {}) {
  const form = new FormData();
  form.append("audio", new File([bytes], "turn.webm", { type }));
  form.append("languageCode", languageCode);
  return form;
}

async function errorBody(response) {
  return (await response.json()).error;
}

test("local translation route handlers", { timeout: 60_000 }, async (t) => {
  const mock = await startMockSarvam(t);
  const baseUrl = await startNextServer(t, {
    SARVAM_API_KEY: "test-sarvam-key",
    SARVAM_API_BASE_URL: mock.url,
    SARVAM_API_TIMEOUT_MS: "75",
  });

  await t.test("transcribes short audio with an explicit language", async () => {
    const response = await fetch(`${baseUrl}/api/local-translation/transcribe`, {
      method: "POST",
      body: audioForm(),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      requestId: "req-stt",
      transcript: "வாசல் எண் இரண்டு",
      languageCode: "ta-IN",
    });
    assert.deepEqual(mock.state.requests.at(-1), {
      path: "/speech-to-text",
      apiKey: "test-sarvam-key",
      model: "saaras:v3",
      mode: "transcribe",
      languageCode: "ta-IN",
      fileName: "turn.webm",
      fileType: "audio/webm;codecs=opus",
    });
  });

  await t.test("translates with the local spoken-conversation settings", async () => {
    const response = await fetch(`${baseUrl}/api/local-translation/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "வாசல் எண் இரண்டு",
        sourceLanguage: "ta-IN",
        targetLanguage: "hi-IN",
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      requestId: "req-translate",
      translatedText: "गेट नंबर दो",
      sourceLanguage: "ta-IN",
      targetLanguage: "hi-IN",
    });
    assert.deepEqual(mock.state.requests.at(-1), {
      path: "/translate",
      apiKey: "test-sarvam-key",
      json: {
        input: "வாசல் எண் இரண்டு",
        source_language_code: "ta-IN",
        target_language_code: "hi-IN",
        model: "mayura:v1",
        mode: "modern-colloquial",
        output_script: "spoken-form-in-native",
        numerals_format: "international",
      },
    });
  });

  await t.test("returns decoded WAV speech", async () => {
    const response = await fetch(`${baseUrl}/api/local-translation/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "गेट नंबर दो", language: "hi-IN" }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "audio/wav");
    assert.equal(response.headers.get("x-sarvam-request-id"), "req-tts");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), fakeWav);
    assert.deepEqual(mock.state.requests.at(-1), {
      path: "/text-to-speech",
      apiKey: "test-sarvam-key",
      json: {
        text: "गेट नंबर दो",
        target_language_code: "hi-IN",
        model: "bulbul:v3",
        speaker: "shubh",
        output_audio_codec: "wav",
        speech_sample_rate: 24_000,
        pace: 1,
        temperature: 0.6,
      },
    });
  });

  await t.test("rejects empty, oversized, and unsupported audio", async () => {
    const empty = await fetch(`${baseUrl}/api/local-translation/transcribe`, {
      method: "POST",
      body: new FormData(),
    });
    assert.equal(empty.status, 400);
    assert.equal((await errorBody(empty)).code, "INVALID_AUDIO");

    const oversized = await fetch(`${baseUrl}/api/local-translation/transcribe`, {
      method: "POST",
      body: audioForm({ bytes: new Uint8Array(4 * 1024 * 1024 + 1) }),
    });
    assert.equal(oversized.status, 413);
    assert.equal((await errorBody(oversized)).code, "PAYLOAD_TOO_LARGE");

    const unsupported = await fetch(`${baseUrl}/api/local-translation/transcribe`, {
      method: "POST",
      body: audioForm({ type: "text/plain" }),
    });
    assert.equal(unsupported.status, 415);
    assert.equal((await errorBody(unsupported)).code, "INVALID_AUDIO");
  });

  await t.test("rejects invalid language and text combinations", async () => {
    const unsupported = await fetch(`${baseUrl}/api/local-translation/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "hello",
        sourceLanguage: "bn-IN",
        targetLanguage: "ta-IN",
      }),
    });
    assert.equal(unsupported.status, 400);
    assert.equal((await errorBody(unsupported)).code, "UNSUPPORTED_LANGUAGE");

    const same = await fetch(`${baseUrl}/api/local-translation/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "வணக்கம்",
        sourceLanguage: "ta-IN",
        targetLanguage: "ta-IN",
      }),
    });
    assert.equal(same.status, 400);
    assert.equal((await errorBody(same)).code, "SAME_LANGUAGE");

    const overlong = await fetch(`${baseUrl}/api/local-translation/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "a".repeat(1_001),
        sourceLanguage: "en-IN",
        targetLanguage: "ta-IN",
      }),
    });
    assert.equal(overlong.status, 400);
    assert.equal((await errorBody(overlong)).code, "INVALID_REQUEST");
  });

  await t.test("blocks cross-origin calls", async () => {
    const response = await fetch(`${baseUrl}/api/local-translation/translate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://malicious.example",
      },
      body: JSON.stringify({
        text: "hello",
        sourceLanguage: "en-IN",
        targetLanguage: "ta-IN",
      }),
    });
    assert.equal(response.status, 403);
    assert.equal((await errorBody(response)).code, "CROSS_ORIGIN_REQUEST");
  });

  await t.test("normalizes malformed, timed-out, and rate-limited upstream responses", async () => {
    mock.state.mode = "malformed";
    const malformed = await fetch(`${baseUrl}/api/local-translation/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "hello",
        sourceLanguage: "en-IN",
        targetLanguage: "ta-IN",
      }),
    });
    assert.equal(malformed.status, 502);
    assert.equal((await errorBody(malformed)).code, "INVALID_SARVAM_RESPONSE");

    mock.state.mode = "timeout";
    const timedOut = await fetch(`${baseUrl}/api/local-translation/transcribe`, {
      method: "POST",
      body: audioForm(),
    });
    assert.equal(timedOut.status, 504);
    assert.equal((await errorBody(timedOut)).code, "SARVAM_TIMEOUT");

    mock.state.mode = "rate-limit";
    const rateLimited = await fetch(`${baseUrl}/api/local-translation/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello", language: "en-IN" }),
    });
    assert.equal(rateLimited.status, 429);
    assert.equal(rateLimited.headers.get("retry-after"), "7");
    assert.equal((await errorBody(rateLimited)).code, "RATE_LIMITED");
    mock.state.mode = "ok";
  });

  await t.test("enforces the per-IP demo rate limit", async () => {
    const headers = {
      "Content-Type": "application/json",
      "X-Forwarded-For": "203.0.113.42",
    };
    for (let index = 0; index < 20; index += 1) {
      const response = await fetch(`${baseUrl}/api/local-translation/translate`, {
        method: "POST",
        headers,
        body: "{}",
      });
      assert.equal(response.status, 400);
    }
    const blocked = await fetch(`${baseUrl}/api/local-translation/translate`, {
      method: "POST",
      headers,
      body: "{}",
    });
    assert.equal(blocked.status, 429);
    assert.equal((await errorBody(blocked)).code, "RATE_LIMITED");
  });

  await t.test("reports a missing server-side API key", async (missingKeyTest) => {
    const noKeyBaseUrl = await startNextServer(missingKeyTest, {
      SARVAM_API_KEY: undefined,
      SARVAM_API_BASE_URL: mock.url,
      SARVAM_API_TIMEOUT_MS: "75",
    });
    const response = await fetch(`${noKeyBaseUrl}/api/local-translation/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "hello",
        sourceLanguage: "en-IN",
        targetLanguage: "ta-IN",
      }),
    });
    assert.equal(response.status, 503);
    assert.equal((await errorBody(response)).code, "SERVICE_NOT_CONFIGURED");
  });
});
