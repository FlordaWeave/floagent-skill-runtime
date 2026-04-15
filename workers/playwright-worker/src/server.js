import http from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { URL } from "node:url";

function parsePositiveInt(rawValue, fallback) {
  const parsed = Number.parseInt(rawValue ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

const defaultPort = parsePositiveInt(process.env.PORT, 3000);
const defaultHandoffTtlMs = Math.max(
  1000,
  parsePositiveInt(process.env.HANDOFF_TTL_SECONDS, 900) * 1000,
);
const defaultMaxContextsPerBrowser = parsePositiveInt(
  process.env.MAX_CONTEXTS_PER_BROWSER,
  8,
);

class WorkerError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "WorkerError";
    this.code = code;
    this.retryable = Boolean(options.retryable);
    this.statusCode = options.statusCode || 500;
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    throw new WorkerError(
      "invalid_request",
      error instanceof Error ? `Invalid JSON body: ${error.message}` : "Invalid JSON body",
      { statusCode: 400 },
    );
  }
}

function baseUrl(req, host) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const scheme = forwardedProto || "http";
  return `${scheme}://${host}`;
}

function sessionKey(taskId, sessionId) {
  return `${taskId}:${sessionId}`;
}

function sessionIdentityFromBody(body) {
  if (!body || typeof body.task_id !== "string" || typeof body.session_id !== "string") {
    throw new WorkerError(
      "invalid_request",
      "task_id and session_id are required string fields",
      { statusCode: 400 },
    );
  }
  return {
    taskId: body.task_id,
    sessionId: body.session_id,
    key: sessionKey(body.task_id, body.session_id),
  };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function normalizeRequestMethod(method) {
  return typeof method === "string" && method.trim().length > 0
    ? method.trim().toUpperCase()
    : null;
}

function normalizeRequestCaptureMatcher(matcher) {
  if (!matcher || typeof matcher !== "object" || Array.isArray(matcher)) {
    throw new WorkerError(
      "invalid_request",
      "start_request_capture matchers must be objects",
      { statusCode: 400 },
    );
  }
  const exactUrl =
    typeof matcher.url === "string" && matcher.url.trim().length > 0
      ? matcher.url.trim()
      : null;
  const regexSource =
    typeof matcher.url_regex === "string" && matcher.url_regex.trim().length > 0
      ? matcher.url_regex.trim()
      : null;
  if (!exactUrl && !regexSource) {
    throw new WorkerError(
      "invalid_request",
      "start_request_capture matcher requires url or url_regex",
      { statusCode: 400 },
    );
  }
  if (exactUrl && regexSource) {
    throw new WorkerError(
      "invalid_request",
      "start_request_capture matcher cannot set both url and url_regex",
      { statusCode: 400 },
    );
  }
  const resourceTypes = matcher.resource_types ?? ["xhr", "fetch"];
  if (!Array.isArray(resourceTypes) || resourceTypes.length === 0) {
    throw new WorkerError(
      "invalid_request",
      "start_request_capture matcher.resource_types must be a non-empty array when provided",
      { statusCode: 400 },
    );
  }
  const normalizedTypes = [];
  for (const resourceType of resourceTypes) {
    if (resourceType !== "xhr" && resourceType !== "fetch") {
      throw new WorkerError(
        "invalid_request",
        `unsupported request resource type: ${resourceType}`,
        { statusCode: 400 },
      );
    }
    if (!normalizedTypes.includes(resourceType)) {
      normalizedTypes.push(resourceType);
    }
  }
  let urlRegex = null;
  if (regexSource) {
    try {
      urlRegex = new RegExp(regexSource);
    } catch (error) {
      throw new WorkerError(
        "invalid_request",
        `start_request_capture matcher.url_regex is invalid: ${errorMessage(error)}`,
        { statusCode: 400 },
      );
    }
  }
  return {
    url: exactUrl,
    urlRegexSource: regexSource,
    urlRegex,
    method: normalizeRequestMethod(matcher.method),
    resourceTypes: new Set(normalizedTypes),
  };
}

function normalizeRequestCaptureMatchers(matchers) {
  if (!Array.isArray(matchers) || matchers.length === 0) {
    throw new WorkerError(
      "invalid_request",
      "start_request_capture requires a non-empty matchers array",
      { statusCode: 400 },
    );
  }
  return matchers.map((matcher) => normalizeRequestCaptureMatcher(matcher));
}

function extractRequestDetails(request) {
  return {
    url: request.url(),
    method: request.method(),
    resource_type: request.resourceType(),
    headers: request.headers(),
  };
}

async function captureRequestWithResponse(request) {
  const response = await request.response();
  if (!response) {
    throw new WorkerError(
      "response_not_available",
      `No response was available for request ${request.url()}`,
    );
  }
  return {
    request: extractRequestDetails(request),
    response: {
      url: response.url(),
      status: response.status(),
      headers: response.headers(),
    },
  };
}

function requestMatchesMatcher(request, matcher) {
  if (matcher.method && request.method().toUpperCase() !== matcher.method) {
    return false;
  }
  if (!matcher.resourceTypes.has(request.resourceType())) {
    return false;
  }
  if (matcher.url && request.url() !== matcher.url) {
    return false;
  }
  if (matcher.urlRegex && !matcher.urlRegex.test(request.url())) {
    return false;
  }
  return true;
}

function browserCommandError(error) {
  return {
    status: "error",
    error: {
      code: error.code || "worker_error",
      message: errorMessage(error),
      retryable: Boolean(error.retryable),
    },
  };
}

function httpErrorPayload(error) {
  return {
    status: "error",
    error: {
      code: error.code || "worker_error",
      message: errorMessage(error),
      retryable: Boolean(error.retryable),
    },
  };
}

export function createPlaywrightWorker(options = {}) {
  const port = options.port ?? defaultPort;
  const handoffTtlMs = options.handoffTtlMs ?? defaultHandoffTtlMs;
  const maxContextsPerBrowser =
    options.maxContextsPerBrowser ?? defaultMaxContextsPerBrowser;
  let chromiumImpl = options.chromiumImpl ?? null;

  const state = {
    browser: null,
    browserPromise: null,
    browserGeneration: 0,
    sessions: new Map(),
    handoffs: new Map(),
    sessionLocks: new Map(),
  };

  function clearSessionHandoff(session) {
    if (!session?.handoff) {
      return;
    }
    state.handoffs.delete(session.handoff.token);
    session.handoff = null;
  }

  function releasePendingCapture(capture, error = null) {
    if (!capture?.pendingCollect) {
      return;
    }
    if (capture.pendingCollect.timerId) {
      clearTimeout(capture.pendingCollect.timerId);
    }
    const { resolve, reject } = capture.pendingCollect;
    capture.pendingCollect = null;
    if (error) {
      reject(error);
    } else {
      resolve([...capture.matches]);
    }
  }

  function deleteRequestCapture(session, captureId) {
    const capture = session?.requestCaptures?.get(captureId) || null;
    if (!capture) {
      return false;
    }
    releasePendingCapture(
      capture,
      new WorkerError(
        "request_capture_stopped",
        `Request capture ${captureId} was stopped before collection completed`,
      ),
    );
    session.requestCaptures.delete(captureId);
    return true;
  }

  function cleanupRequestCaptures(session, reason = "invalidated") {
    if (!session?.requestCaptures) {
      return;
    }
    for (const capture of session.requestCaptures.values()) {
      releasePendingCapture(
        capture,
        new WorkerError(
          "request_capture_invalidated",
          `Request capture ${capture.id} was ${reason}`,
        ),
      );
    }
    session.requestCaptures.clear();
  }

  async function closeSession(session) {
    if (!session) {
      return;
    }
    clearSessionHandoff(session);
    cleanupRequestCaptures(session, "invalidated");
    if (session.requestCaptureListener) {
      session.page.off("request", session.requestCaptureListener);
    }
    try {
      await session.context.close();
    } catch {
      // Best effort cleanup for already-closed contexts after browser loss.
    }
  }

  async function handleBrowserDisconnect(disconnectedBrowser) {
    if (state.browser !== disconnectedBrowser) {
      return;
    }
    state.browser = null;
    state.browserPromise = null;
    state.browserGeneration += 1;
    const sessions = [...state.sessions.values()];
    state.sessions.clear();
    state.handoffs.clear();
    await Promise.all(sessions.map((session) => closeSession(session)));
  }

  async function ensureBrowser() {
    if (state.browser) {
      return state.browser;
    }
    if (!state.browserPromise) {
      if (!chromiumImpl) {
        ({ chromium: chromiumImpl } = await import("playwright"));
      }
      state.browserPromise = chromiumImpl
        .launch({
          headless: true,
          args: ["--remote-debugging-address=0.0.0.0", "--remote-debugging-port=9222"],
        })
        .then((browser) => {
          state.browser = browser;
          browser.on("disconnected", () => {
            void handleBrowserDisconnect(browser);
          });
          return browser;
        })
        .catch((error) => {
          state.browserPromise = null;
          throw error;
        })
        .finally(() => {
          state.browserPromise = null;
        });
    }
    return state.browserPromise;
  }

  function isBrowserClosedError(error, initialGeneration) {
    if (state.browserGeneration !== initialGeneration) {
      return true;
    }
    if (!(error instanceof Error)) {
      return false;
    }
    const haystack = `${error.name} ${error.message}`.toLowerCase();
    return (
      haystack.includes("target page, context or browser has been closed") ||
      haystack.includes("browser has been closed") ||
      haystack.includes("target closed") ||
      haystack.includes("target crashed") ||
      haystack.includes("browser closed")
    );
  }

  function classifyError(error, initialGeneration) {
    if (error instanceof WorkerError) {
      return error;
    }
    if (isBrowserClosedError(error, initialGeneration)) {
      return new WorkerError(
        "browser_instance_crashed",
        "Browser instance crashed or disconnected. Retry the request.",
        { retryable: true, statusCode: 503 },
      );
    }
    return new WorkerError("worker_error", errorMessage(error));
  }

  async function withBrowserHandling(operation) {
    const initialGeneration = state.browserGeneration;
    try {
      return await operation();
    } catch (error) {
      throw classifyError(error, initialGeneration);
    }
  }

  function withSessionLock(key, operation) {
    const previous = state.sessionLocks.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    const queued = current.catch(() => {}).finally(() => {
      if (state.sessionLocks.get(key) === queued) {
        state.sessionLocks.delete(key);
      }
    });
    state.sessionLocks.set(key, queued);
    return current;
  }

  function getSession(identity) {
    return state.sessions.get(identity.key) || null;
  }

  async function handleSessionRequestCapture(session, request) {
    if (!session?.requestCaptures || session.requestCaptures.size === 0) {
      return;
    }
    const matchingCaptureIds = [];
    for (const capture of session.requestCaptures.values()) {
      if (capture.matchers.some((matcher) => requestMatchesMatcher(request, matcher))) {
        matchingCaptureIds.push(capture.id);
      }
    }
    if (matchingCaptureIds.length === 0) {
      return;
    }
    let capturedRequest;
    try {
      capturedRequest = await captureRequestWithResponse(request);
    } catch {
      return;
    }
    for (const captureId of matchingCaptureIds) {
      const capture = session.requestCaptures.get(captureId);
      if (!capture) {
        continue;
      }
      capture.matches.push(capturedRequest);
      if (capture.pendingCollect) {
        const matches = [...capture.matches];
        const { resolve, timerId } = capture.pendingCollect;
        if (timerId) {
          clearTimeout(timerId);
        }
        capture.pendingCollect = null;
        session.requestCaptures.delete(captureId);
        resolve(matches);
      }
    }
  }

  async function createSession(identity, storageState) {
    const existing = getSession(identity);
    if (existing) {
      return existing;
    }
    if (state.sessions.size >= maxContextsPerBrowser) {
      throw new WorkerError(
        "context_limit_reached",
        `Browser instance already has ${maxContextsPerBrowser} active contexts`,
        { statusCode: 409 },
      );
    }
    const browser = await ensureBrowser();
    const context = await browser.newContext(storageState ? { storageState } : {});
    const page = await context.newPage();
    const session = {
      key: identity.key,
      taskId: identity.taskId,
      sessionId: identity.sessionId,
      context,
      page,
      handoff: null,
      requestCaptures: new Map(),
      requestCaptureListener: null,
    };
    session.requestCaptureListener = (request) => {
      void handleSessionRequestCapture(session, request);
    };
    page.on("request", session.requestCaptureListener);
    state.sessions.set(identity.key, session);
    return session;
  }

  async function ensureSession(identity) {
    return createSession(identity);
  }

  async function resetSession(identity, storageState) {
    const existing = getSession(identity);
    if (existing) {
      state.sessions.delete(identity.key);
      await closeSession(existing);
    }
    return createSession(identity, storageState);
  }

  async function stopSession(identity) {
    const existing = getSession(identity);
    if (!existing) {
      return;
    }
    state.sessions.delete(identity.key);
    await closeSession(existing);
  }

  async function currentUrl(session) {
    return session?.page ? session.page.url() : null;
  }

  async function startRequestCapture(session, command) {
    const matchers = normalizeRequestCaptureMatchers(command.matchers);
    const captureId = randomUUID();
    session.requestCaptures.set(captureId, {
      id: captureId,
      matchers,
      matches: [],
      pendingCollect: null,
    });
    return {
      current_url: await currentUrl(session),
      value: {
        capture_id: captureId,
      },
    };
  }

  async function collectCapturedRequests(session, command) {
    const capture = session.requestCaptures.get(command.capture_id);
    if (!capture) {
      throw new WorkerError(
        "request_capture_not_found",
        `Request capture ${command.capture_id} does not exist`,
        { statusCode: 404 },
      );
    }
    if (
      command.timeout_ms !== undefined &&
      (!Number.isFinite(command.timeout_ms) || command.timeout_ms <= 0)
    ) {
      throw new WorkerError(
        "invalid_request",
        "collect_captured_requests timeout_ms must be a positive number when provided",
        { statusCode: 400 },
      );
    }
    if (capture.pendingCollect) {
      throw new WorkerError(
        "invalid_request",
        `Request capture ${command.capture_id} is already being collected`,
        { statusCode: 409 },
      );
    }
    let captures;
    if (capture.matches.length > 0) {
      captures = [...capture.matches];
      session.requestCaptures.delete(command.capture_id);
    } else {
      const timeoutMs = command.timeout_ms || 30_000;
      captures = await new Promise((resolve, reject) => {
        capture.pendingCollect = {
          resolve,
          reject,
          timerId: setTimeout(() => {
            capture.pendingCollect = null;
            session.requestCaptures.delete(command.capture_id);
            reject(
              new WorkerError(
                "request_capture_timed_out",
                `No matching request was captured within ${timeoutMs}ms for ${command.capture_id}`,
              ),
            );
          }, timeoutMs),
        };
      });
    }
    return {
      current_url: await currentUrl(session),
      value: {
        captures,
      },
    };
  }

  async function stopRequestCapture(session, command) {
    deleteRequestCapture(session, command.capture_id);
    return {
      current_url: await currentUrl(session),
      value: {
        stopped: true,
      },
    };
  }

  function activeHandoffForSession(session) {
    if (session?.handoff && session.handoff.expiresAt > Date.now()) {
      return session.handoff;
    }
    clearSessionHandoff(session);
    return null;
  }

  function handoffForRequest(req, session) {
    const active = activeHandoffForSession(session);
    if (active) {
      return active;
    }
    const token = randomUUID();
    const host = req.headers.host || `127.0.0.1:${port}`;
    const handoff = {
      token,
      operatorUrl: `${baseUrl(req, host)}/handoff/${token}`,
      expiresAt: Date.now() + handoffTtlMs,
    };
    session.handoff = handoff;
    state.handoffs.set(token, session.key);
    return handoff;
  }

  function sessionForToken(token) {
    const key = state.handoffs.get(token);
    if (!key) {
      return null;
    }
    const session = state.sessions.get(key);
    if (!session) {
      state.handoffs.delete(token);
      return null;
    }
    if (!session.handoff || session.handoff.token !== token || session.handoff.expiresAt <= Date.now()) {
      clearSessionHandoff(session);
      return null;
    }
    return session;
  }

  async function evaluateRequiredChecks(session, requiredChecks, req) {
    for (const check of requiredChecks || []) {
      if (check.kind === "url_not_matches") {
        const url = await currentUrl(session);
        if (url && !new RegExp(check.value).test(url)) {
          continue;
        }
        const handoff = handoffForRequest(req, session);
        return {
          status: "action_needed",
          action: {
            code: check.reason_code || "login_required",
            message:
              check.user_message ||
              "Login required. Open the operator handoff URL, finish the login flow, then resume the task.",
            handoff: {
              token: handoff.token,
              operator_url: handoff.operatorUrl,
              expires_at: new Date(handoff.expiresAt).toISOString(),
            },
          },
        };
      }
      if (check.kind === "selector_present") {
        const locator = session.page.locator(check.value);
        const visible = await locator.first().isVisible().catch(() => false);
        if (visible) {
          const handoff = handoffForRequest(req, session);
          return {
            status: "action_needed",
            action: {
              code: check.reason_code || "login_required",
              message:
                check.user_message ||
                "Login required. Open the operator handoff URL, finish the login flow, then resume the task.",
              handoff: {
                token: handoff.token,
                operator_url: handoff.operatorUrl,
                expires_at: new Date(handoff.expiresAt).toISOString(),
              },
            },
          };
        }
      }
      if (check.kind === "selector_absent") {
        const locator = session.page.locator(check.value);
        const visible = await locator.first().isVisible().catch(() => false);
        if (!visible) {
          const handoff = handoffForRequest(req, session);
          return {
            status: "action_needed",
            action: {
              code: check.reason_code || "login_required",
              message:
                check.user_message ||
                "Login required. Open the operator handoff URL, finish the login flow, then resume the task.",
              handoff: {
                token: handoff.token,
                operator_url: handoff.operatorUrl,
                expires_at: new Date(handoff.expiresAt).toISOString(),
              },
            },
          };
        }
      }
    }
    return null;
  }

async function executeCommand(session, command) {
  switch (command.type) {
    case "goto":
      await session.page.goto(command.url, {
        waitUntil: command.wait_until || "domcontentloaded",
        timeout: command.timeout_ms || 30_000,
      });
      return { current_url: await currentUrl(session) };
    case "start_request_capture":
      return startRequestCapture(session, command);
    case "collect_captured_requests":
      return collectCapturedRequests(session, command);
    case "stop_request_capture":
      return stopRequestCapture(session, command);
    case "fill":
      await session.page.locator(command.selector).fill(command.value);
      return { current_url: await currentUrl(session) };
    case "click":
      await session.page.locator(command.selector).click();
      return { current_url: await currentUrl(session) };
    case "press":
      await session.page.locator(command.selector).press(command.key);
      return { current_url: await currentUrl(session) };
    case "select":
      await session.page.locator(command.selector).selectOption(command.values);
      return { current_url: await currentUrl(session) };
    case "wait_for":
      if (command.selector) {
        await session.page.locator(command.selector).waitFor({ timeout: command.timeout_ms });
      } else if (command.url) {
        await session.page.waitForURL(command.url, { timeout: command.timeout_ms });
      } else if (command.text) {
        await session.page.getByText(command.text).waitFor({ timeout: command.timeout_ms });
      }
      return { current_url: await currentUrl(session) };
    case "extract": {
      const locator = session.page.locator(command.selector).first();
      if (command.attribute) {
        return {
          current_url: await currentUrl(session),
          attribute: await locator.getAttribute(command.attribute),
        };
      }
      return {
        current_url: await currentUrl(session),
        text: command.text_content
          ? await locator.textContent()
          : await locator.innerText(),
      };
    }
    case "evaluate": {
      const value = await session.page.evaluate(
        async ({ expression, args }) => {
          const evaluator = new Function(
            "args",
            `return (async () => (${expression}))();`,
          );
          const result = await evaluator(args ?? null);
          if (result === undefined) {
            return null;
          }
          try {
            return JSON.parse(JSON.stringify(result));
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            throw new Error(
              `evaluate result is not JSON-serializable: ${message}`,
            );
          }
        },
        {
          expression: command.expression,
          args: command.args ?? null,
        },
      );
      return {
        current_url: await currentUrl(session),
        value,
      };
    }
    case "screenshot":
      return {
        current_url: await currentUrl(session),
        screenshot_base64: (
          await session.page.screenshot({ fullPage: Boolean(command.full_page) })
        ).toString("base64"),
      };
    default:
      throw new WorkerError(
        "invalid_request",
        `Unsupported command type: ${command.type}`,
        { statusCode: 400 },
      );
  }
}

  function handoffHtml(token) {
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Playwright Handoff</title>
    <style>
      body { font-family: monospace; margin: 24px; background: #f3f0e8; color: #1f1f1f; }
      form { margin: 12px 0; padding: 12px; background: white; border: 1px solid #c9c0b2; }
      input { width: 100%; margin: 4px 0; padding: 8px; }
      button { padding: 8px 12px; }
      img { width: 100%; max-width: 960px; border: 1px solid #c9c0b2; background: white; }
      .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    </style>
  </head>
  <body>
    <h1>Browser Handoff</h1>
    <p>Use these constrained controls to complete login, then resume the task from the task status URL.</p>
    <p>Current URL: <code id="current-url">loading</code></p>
    <img id="screenshot" src="/v1/handoff/${token}/screenshot" />
    <div class="row">
      <form id="goto-form">
        <h2>Goto</h2>
        <input name="url" placeholder="https://example.com" />
        <button>Open URL</button>
      </form>
      <form id="click-form">
        <h2>Click</h2>
        <input name="selector" placeholder="#login" />
        <button>Click</button>
      </form>
      <form id="fill-form">
        <h2>Fill</h2>
        <input name="selector" placeholder="input[name=email]" />
        <input name="value" placeholder="value" />
        <button>Fill</button>
      </form>
      <form id="press-form">
        <h2>Press</h2>
        <input name="selector" placeholder="input[name=password]" />
        <input name="key" placeholder="Enter" />
        <button>Press</button>
      </form>
    </div>
    <script>
      async function send(type, payload) {
        const response = await fetch("/v1/handoff/${token}/actions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type, ...payload })
        });
        const data = await response.json();
        document.getElementById("current-url").textContent = data.current_url || "";
        document.getElementById("screenshot").src = "/v1/handoff/${token}/screenshot?t=" + Date.now();
      }
      for (const [formId, type, fields] of [
        ["goto-form", "goto", ["url"]],
        ["click-form", "click", ["selector"]],
        ["fill-form", "fill", ["selector", "value"]],
        ["press-form", "press", ["selector", "key"]]
      ]) {
        document.getElementById(formId).addEventListener("submit", (event) => {
          event.preventDefault();
          const form = new FormData(event.target);
          const payload = {};
          for (const field of fields) payload[field] = form.get(field);
          send(type, payload);
        });
      }
      setInterval(() => {
        document.getElementById("screenshot").src = "/v1/handoff/${token}/screenshot?t=" + Date.now();
      }, 5000);
      fetch("/v1/handoff/${token}/meta").then((r) => r.json()).then((data) => {
        document.getElementById("current-url").textContent = data.current_url || "";
      });
    </script>
  </body>
</html>`;
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
      if (req.method === "GET" && url.pathname === "/healthz") {
        return sendJson(res, 200, { status: "ok" });
      }
      if (req.method === "POST" && url.pathname === "/v1/session/start") {
        const body = await readJson(req);
        const identity = sessionIdentityFromBody(body);
        const session = await withSessionLock(identity.key, () =>
          withBrowserHandling(() => ensureSession(identity)),
        );
        return sendJson(res, 200, { current_url: await currentUrl(session) });
      }
      if (req.method === "POST" && url.pathname === "/v1/session/stop") {
        const body = await readJson(req);
        const identity = sessionIdentityFromBody(body);
        await withSessionLock(identity.key, () => stopSession(identity));
        return sendJson(res, 200, { current_url: null });
      }
      if (req.method === "POST" && url.pathname === "/v1/storage-state/export") {
        const body = await readJson(req);
        const identity = sessionIdentityFromBody(body);
        const stateResponse = await withSessionLock(identity.key, async () =>
          withBrowserHandling(async () => {
            const session = await ensureSession(identity);
            const storageState = await session.context.storageState();
            return {
              state: {
                cookies: storageState.cookies,
                origins: storageState.origins,
              },
            };
          }),
        );
        return sendJson(res, 200, stateResponse);
      }
      if (req.method === "POST" && url.pathname === "/v1/storage-state/import") {
        const body = await readJson(req);
        const identity = sessionIdentityFromBody(body);
        const session = await withSessionLock(identity.key, () =>
          withBrowserHandling(() => resetSession(identity, body.state)),
        );
        return sendJson(res, 200, { current_url: await currentUrl(session) });
      }
      if (req.method === "POST" && url.pathname === "/v1/commands") {
        const body = await readJson(req);
        const identity = sessionIdentityFromBody(body);
        try {
          const response = await withSessionLock(identity.key, async () =>
            withBrowserHandling(async () => {
              const session = await ensureSession(identity);
              const result = await executeCommand(session, body.command);
              const actionNeeded = await evaluateRequiredChecks(
                session,
                body.required_checks,
                req,
              );
              if (actionNeeded) {
                return actionNeeded;
              }
              clearSessionHandoff(session);
              return { status: "ok", result };
            }),
          );
          return sendJson(res, 200, response);
        } catch (error) {
          return sendJson(res, 200, browserCommandError(error));
        }
      }
      const handoffMatch = url.pathname.match(/^\/handoff\/([^/]+)$/);
      if (req.method === "GET" && handoffMatch) {
        const session = sessionForToken(handoffMatch[1]);
        if (!session) {
          res.writeHead(404);
          res.end("handoff expired");
          return;
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(handoffHtml(session.handoff.token));
        return;
      }
      const screenshotMatch = url.pathname.match(/^\/v1\/handoff\/([^/]+)\/screenshot$/);
      if (req.method === "GET" && screenshotMatch) {
        const session = sessionForToken(screenshotMatch[1]);
        if (!session) {
          res.writeHead(404);
          res.end("handoff expired");
          return;
        }
        const buffer = await withSessionLock(session.key, () =>
          withBrowserHandling(() => session.page.screenshot({ fullPage: true })),
        );
        res.writeHead(200, { "content-type": "image/png" });
        res.end(buffer);
        return;
      }
      const metaMatch = url.pathname.match(/^\/v1\/handoff\/([^/]+)\/meta$/);
      if (req.method === "GET" && metaMatch) {
        const session = sessionForToken(metaMatch[1]);
        if (!session) {
          return sendJson(res, 404, { error: "handoff expired" });
        }
        const meta = await withSessionLock(session.key, () =>
          withBrowserHandling(async () => ({ current_url: await currentUrl(session) })),
        );
        return sendJson(res, 200, meta);
      }
      const actionMatch = url.pathname.match(/^\/v1\/handoff\/([^/]+)\/actions$/);
      if (req.method === "POST" && actionMatch) {
        const session = sessionForToken(actionMatch[1]);
        if (!session) {
          return sendJson(res, 404, { error: "handoff expired" });
        }
        const body = await readJson(req);
        const result = await withSessionLock(session.key, () =>
          withBrowserHandling(async () => {
            if (body.type === "goto") {
              return executeCommand(session, { type: "goto", url: body.url });
            }
            if (body.type === "click") {
              return executeCommand(session, { type: "click", selector: body.selector });
            }
            if (body.type === "fill") {
              return executeCommand(session, {
                type: "fill",
                selector: body.selector,
                value: body.value,
              });
            }
            if (body.type === "press") {
              return executeCommand(session, {
                type: "press",
                selector: body.selector,
                key: body.key,
              });
            }
            throw new WorkerError(
              "invalid_request",
              `Unsupported handoff action: ${body.type}`,
              { statusCode: 400 },
            );
          }),
        );
        return sendJson(res, 200, result);
      }

      res.writeHead(404);
      res.end("not found");
    } catch (error) {
      const workerError = error instanceof WorkerError ? error : new WorkerError("worker_error", errorMessage(error));
      console.error(
        `[playwright-worker] ${req.method || "UNKNOWN"} ${req.url || "/"} failed: ${workerError.code}: ${workerError.message}`,
        error instanceof Error && error.stack ? `\n${error.stack}` : "",
      );
      sendJson(res, workerError.statusCode, httpErrorPayload(workerError));
    }
  });

  return { server, state };
}

const isMainModule =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  const { server } = createPlaywrightWorker();
  server.listen(defaultPort, () => {
    console.log(`playwright worker listening on ${defaultPort}`);
  });
}
