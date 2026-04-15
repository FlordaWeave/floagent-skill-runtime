import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { createPlaywrightWorker } from "./server.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class FakeLocator {
  constructor(page, selector) {
    this.page = page;
    this.selector = selector;
  }

  first() {
    return this;
  }

  async fill(value) {
    await this.page.beforeOperation("fill");
    this.page.values.set(this.selector, value);
  }

  async click() {
    await this.page.beforeOperation("click");
    this.page.clicks.push(this.selector);
  }

  async press(key) {
    await this.page.beforeOperation("press");
    this.page.keys.push({ selector: this.selector, key });
  }

  async selectOption(values) {
    await this.page.beforeOperation("select");
    this.page.selected.set(this.selector, values);
  }

  async waitFor() {
    await this.page.beforeOperation("wait_for");
  }

  async getAttribute(attribute) {
    await this.page.beforeOperation("get_attribute");
    return this.page.attributes.get(`${this.selector}:${attribute}`) || null;
  }

  async textContent() {
    await this.page.beforeOperation("text_content");
    return this.page.textBySelector.get(this.selector) || null;
  }

  async innerText() {
    await this.page.beforeOperation("inner_text");
    return this.page.textBySelector.get(this.selector) || "";
  }

  async isVisible() {
    await this.page.beforeOperation("is_visible");
    return this.page.visibleSelectors.has(this.selector);
  }
}

class FakeRequest {
  constructor({ url, method = "GET", resourceType = "fetch", headers = {}, response = null }) {
    this.urlValue = url;
    this.methodValue = method;
    this.resourceTypeValue = resourceType;
    this.headersValue = headers;
    this.responseValue = response;
  }

  url() {
    return this.urlValue;
  }

  method() {
    return this.methodValue;
  }

  resourceType() {
    return this.resourceTypeValue;
  }

  headers() {
    return this.headersValue;
  }

  async response() {
    return this.responseValue ? new FakeResponse(this.responseValue) : null;
  }
}

class FakeResponse {
  constructor({ url, status = 200, headers = {}, bodyText = "" }) {
    this.urlValue = url;
    this.statusValue = status;
    this.headersValue = headers;
    this.bodyTextValue = bodyText;
  }

  url() {
    return this.urlValue;
  }

  status() {
    return this.statusValue;
  }

  headers() {
    return this.headersValue;
  }

  async text() {
    return this.bodyTextValue;
  }
}

class FakePage extends EventEmitter {
  constructor(context) {
    super();
    this.context = context;
    this.urlValue = "about:blank";
    this.cookieValue = "";
    this.localStorageMap = new Map();
    this.sessionStorageMap = new Map();
    this.values = new Map();
    this.selected = new Map();
    this.attributes = new Map();
    this.textBySelector = new Map();
    this.visibleSelectors = new Set();
    this.clicks = [];
    this.keys = [];
  }

  async beforeOperation(kind) {
    const hooks = this.context.browser.hooks;
    if (hooks.beforeOperation) {
      await hooks.beforeOperation({
        browser: this.context.browser,
        context: this.context,
        page: this,
        kind,
      });
    }
    if (this.context.browser.disconnectOnNextOperation) {
      this.context.browser.disconnectOnNextOperation = false;
      this.context.browser.disconnect();
      throw new Error("Target page, context or browser has been closed");
    }
    if (this.context.browser.disconnected) {
      throw new Error("Target page, context or browser has been closed");
    }
  }

  url() {
    return this.urlValue;
  }

  async goto(url) {
    await this.beforeOperation("goto");
    this.urlValue = url;
  }

  emitRequest(request) {
    this.emit("request", new FakeRequest(request));
  }

  locator(selector) {
    return new FakeLocator(this, selector);
  }

  getByText(text) {
    return {
      waitFor: async () => {
        await this.beforeOperation(`text:${text}`);
      },
    };
  }

  async waitForURL(url) {
    await this.beforeOperation("wait_for_url");
    if (typeof url === "string") {
      this.urlValue = url;
    }
  }

  async screenshot() {
    await this.beforeOperation("screenshot");
    return Buffer.from(`screenshot:${this.urlValue}`);
  }

  async evaluate(pageFunction, arg) {
    await this.beforeOperation("evaluate");
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    const previousLocalStorage = globalThis.localStorage;
    const previousSessionStorage = globalThis.sessionStorage;
    const previousLocation = globalThis.location;
    const createStorage = (store) => ({
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => {
        store.set(key, String(value));
      },
      removeItem: (key) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
      key: (index) => Array.from(store.keys())[index] ?? null,
      get length() {
        return store.size;
      },
    });
    const localStorage = createStorage(this.localStorageMap);
    const sessionStorage = createStorage(this.sessionStorageMap);
    try {
      globalThis.document = { cookie: this.cookieValue };
      globalThis.localStorage = localStorage;
      globalThis.sessionStorage = sessionStorage;
      globalThis.location = { href: this.urlValue };
      globalThis.window = {
        document: globalThis.document,
        localStorage,
        sessionStorage,
        location: globalThis.location,
      };
      return await pageFunction(arg);
    } finally {
      globalThis.document = previousDocument;
      globalThis.window = previousWindow;
      globalThis.localStorage = previousLocalStorage;
      globalThis.sessionStorage = previousSessionStorage;
      globalThis.location = previousLocation;
    }
  }
}

class FakeContext {
  constructor(browser, options = {}) {
    this.browser = browser;
    this.options = options;
    this.closed = false;
    this.page = new FakePage(this);
    this.closeCount = 0;
  }

  async newPage() {
    if (this.browser.disconnected) {
      throw new Error("Target page, context or browser has been closed");
    }
    return this.page;
  }

  async close() {
    this.closed = true;
    this.closeCount += 1;
  }

  async storageState() {
    return this.options.storageState || { cookies: [], origins: [] };
  }
}

class FakeBrowser extends EventEmitter {
  constructor() {
    super();
    this.contexts = [];
    this.disconnected = false;
    this.disconnectOnNextOperation = false;
    this.hooks = {};
  }

  async newContext(options = {}) {
    if (this.disconnected) {
      throw new Error("Target page, context or browser has been closed");
    }
    const context = new FakeContext(this, options);
    this.contexts.push(context);
    return context;
  }

  disconnect() {
    if (this.disconnected) {
      return;
    }
    this.disconnected = true;
    this.emit("disconnected");
  }
}

async function startWorker(options = {}) {
  const launchCalls = [];
  const browsers = [];
  const chromiumImpl = options.chromiumImpl || {
    async launch() {
      const browser = new FakeBrowser();
      if (options.browserHook) {
        options.browserHook(browser, browsers.length);
      }
      browsers.push(browser);
      launchCalls.push(browser);
      return browser;
    },
  };

  const worker = createPlaywrightWorker({
    chromiumImpl,
    handoffTtlMs: options.handoffTtlMs || 60_000,
    maxContextsPerBrowser: options.maxContextsPerBrowser || 8,
    port: 0,
  });

  await new Promise((resolve) => worker.server.listen(0, "127.0.0.1", resolve));
  const address = worker.server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    ...worker,
    baseUrl,
    launchCalls,
    browsers,
    async close() {
      await new Promise((resolve, reject) => {
        worker.server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function postJson(baseUrl, path, payload) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  return { response, body };
}

async function getJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  const body = await response.json();
  return { response, body };
}

test("handoff url shape stays token scoped", () => {
  const token = "token-1";
  const operatorUrl = `http://worker:3000/handoff/${token}`;
  assert.equal(operatorUrl.endsWith(`/handoff/${token}`), true);
});

test("reuses one browser across multiple sessions", async () => {
  const worker = await startWorker();
  try {
    const first = await postJson(worker.baseUrl, "/v1/session/start", {
      task_id: "task-a",
      session_id: "session-a",
    });
    const second = await postJson(worker.baseUrl, "/v1/session/start", {
      task_id: "task-b",
      session_id: "session-b",
    });

    assert.equal(first.response.status, 200);
    assert.equal(second.response.status, 200);
    assert.equal(worker.launchCalls.length, 1);
    assert.equal(worker.browsers[0].contexts.length, 2);
  } finally {
    await worker.close();
  }
});

test("enforces max contexts per browser instance", async () => {
  const worker = await startWorker({ maxContextsPerBrowser: 1 });
  try {
    const first = await postJson(worker.baseUrl, "/v1/session/start", {
      task_id: "task-a",
      session_id: "session-a",
    });
    const second = await postJson(worker.baseUrl, "/v1/session/start", {
      task_id: "task-b",
      session_id: "session-b",
    });

    assert.equal(first.response.status, 200);
    assert.equal(second.response.status, 409);
    assert.equal(second.body.error.code, "context_limit_reached");
  } finally {
    await worker.close();
  }
});

test("storage-state import resets only the targeted session", async () => {
  const worker = await startWorker();
  try {
    await postJson(worker.baseUrl, "/v1/session/start", {
      task_id: "task-a",
      session_id: "session-a",
    });
    await postJson(worker.baseUrl, "/v1/session/start", {
      task_id: "task-b",
      session_id: "session-b",
    });

    const browser = worker.browsers[0];
    const originalFirstContext = browser.contexts[0];
    const secondContext = browser.contexts[1];

    const imported = await postJson(worker.baseUrl, "/v1/storage-state/import", {
      task_id: "task-a",
      session_id: "session-a",
      state: {
        cookies: [{ name: "sid", value: "1" }],
        origins: [],
      },
    });

    assert.equal(imported.response.status, 200);
    assert.equal(originalFirstContext.closed, true);
    assert.equal(secondContext.closed, false);
    assert.equal(browser.contexts.length, 3);
    assert.deepEqual(browser.contexts[2].options.storageState.cookies, [
      { name: "sid", value: "1" },
    ]);
  } finally {
    await worker.close();
  }
});

test("handoff tokens stay scoped to their session", async () => {
  const worker = await startWorker();
  try {
    await postJson(worker.baseUrl, "/v1/commands", {
      task_id: "task-a",
      session_id: "session-a",
      command: { type: "goto", url: "https://example.com/a" },
      required_checks: [
        { kind: "selector_absent", value: "#logged-in" },
      ],
    });
    await postJson(worker.baseUrl, "/v1/commands", {
      task_id: "task-b",
      session_id: "session-b",
      command: { type: "goto", url: "https://example.com/b" },
      required_checks: [
        { kind: "selector_absent", value: "#logged-in" },
      ],
    });

    const firstToken = worker.state.sessions.get("task-a:session-a").handoff.token;
    const secondToken = worker.state.sessions.get("task-b:session-b").handoff.token;

    assert.notEqual(firstToken, secondToken);

    const firstMeta = await getJson(worker.baseUrl, `/v1/handoff/${firstToken}/meta`);
    const secondMeta = await getJson(worker.baseUrl, `/v1/handoff/${secondToken}/meta`);

    assert.equal(firstMeta.body.current_url, "https://example.com/a");
    assert.equal(secondMeta.body.current_url, "https://example.com/b");
  } finally {
    await worker.close();
  }
});

test("browser disconnect returns a retryable command error and recreates lazily", async () => {
  const worker = await startWorker({
    browserHook(browser, index) {
      if (index === 0) {
        browser.disconnectOnNextOperation = true;
      }
    },
  });
  try {
    const crashed = await postJson(worker.baseUrl, "/v1/commands", {
      task_id: "task-a",
      session_id: "session-a",
      command: { type: "goto", url: "https://example.com/a" },
      required_checks: [],
    });

    assert.equal(crashed.response.status, 200);
    assert.equal(crashed.body.status, "error");
    assert.equal(crashed.body.error.code, "browser_instance_crashed");
    assert.equal(crashed.body.error.retryable, true);
    assert.equal(worker.state.sessions.size, 0);

    const restarted = await postJson(worker.baseUrl, "/v1/session/start", {
      task_id: "task-b",
      session_id: "session-b",
    });

    assert.equal(restarted.response.status, 200);
    assert.equal(worker.launchCalls.length, 2);
  } finally {
    await worker.close();
  }
});

test("evaluate returns structured JSON data from page context", async () => {
  const worker = await startWorker({
    browserHook(browser) {
      browser.hooks.beforeOperation = async ({ page, kind }) => {
        if (kind === "evaluate") {
          page.cookieValue = "sid=abc";
          page.localStorageMap.set("token", "secret");
          page.sessionStorageMap.set("tab", "active");
        }
      };
    },
  });
  try {
    const evaluated = await postJson(worker.baseUrl, "/v1/commands", {
      task_id: "task-a",
      session_id: "session-a",
      command: {
        type: "evaluate",
        expression:
          "({ cookie: document.cookie, token: localStorage.getItem('token'), tab: sessionStorage.getItem('tab') })",
      },
      required_checks: [],
    });

    assert.equal(evaluated.response.status, 200);
    assert.equal(evaluated.body.status, "ok");
    assert.deepEqual(evaluated.body.result.value, {
      cookie: "sid=abc",
      token: "secret",
      tab: "active",
    });
  } finally {
    await worker.close();
  }
});

test("evaluate accepts args and returns null for undefined", async () => {
  const worker = await startWorker();
  try {
    const evaluated = await postJson(worker.baseUrl, "/v1/commands", {
      task_id: "task-a",
      session_id: "session-a",
      command: {
        type: "evaluate",
        expression:
          "args?.mode === 'value' ? { doubled: args.number * 2 } : undefined",
        args: {
          mode: "value",
          number: 21,
        },
      },
      required_checks: [],
    });

    assert.equal(evaluated.response.status, 200);
    assert.equal(evaluated.body.status, "ok");
    assert.deepEqual(evaluated.body.result.value, { doubled: 42 });

    const undefinedResult = await postJson(worker.baseUrl, "/v1/commands", {
      task_id: "task-a",
      session_id: "session-a",
      command: {
        type: "evaluate",
        expression: "undefined",
      },
      required_checks: [],
    });

    assert.equal(undefinedResult.response.status, 200);
    assert.equal(undefinedResult.body.status, "ok");
    assert.equal(undefinedResult.body.result.value, null);
  } finally {
    await worker.close();
  }
});

test("request capture collects multiple responses in observed order", async () => {
  const worker = await startWorker({
    browserHook(browser) {
      browser.hooks.beforeOperation = async ({ kind, page }) => {
        if (kind === "goto") {
          page.emitRequest({
            url: "https://api.example.com/profile",
            method: "GET",
            resourceType: "fetch",
            headers: {
              accept: "application/json",
            },
            response: {
              url: "https://api.example.com/profile",
              status: 200,
              headers: { "content-type": "application/json" },
            },
          });
          page.emitRequest({
            url: "https://api.example.com/data",
            method: "POST",
            resourceType: "xhr",
            headers: {
              authorization: "Bearer secret",
              "x-trace-id": "trace-1",
            },
            response: {
              url: "https://api.example.com/data",
              status: 201,
              headers: { "content-type": "application/json" },
            },
          });
        }
      };
    },
  });
  try {
    const startResponse = await postJson(worker.baseUrl, "/v1/commands", {
      task_id: "task-a",
      session_id: "session-a",
      command: {
        type: "start_request_capture",
        matchers: [
          {
            url: "https://api.example.com/data",
            method: "POST",
            resource_types: ["xhr"],
          },
          {
            url_regex: "^https://api\\.example\\.com/profile$",
            resource_types: ["fetch"],
          },
        ],
      },
      required_checks: [],
    });
    const captureId = startResponse.body.result.value.capture_id;

    await postJson(worker.baseUrl, "/v1/commands", {
      task_id: "task-a",
      session_id: "session-a",
      command: {
        type: "goto",
        url: "https://example.com/app",
        wait_until: "networkidle",
        timeout_ms: 30_000,
      },
      required_checks: [],
    });

    const response = await postJson(worker.baseUrl, "/v1/commands", {
      task_id: "task-a",
      session_id: "session-a",
      command: {
        type: "collect_captured_requests",
        capture_id: captureId,
        timeout_ms: 5_000,
      },
      required_checks: [],
    });

    assert.equal(response.response.status, 200);
    assert.equal(response.body.status, "ok");
    assert.equal(response.body.result.current_url, "https://example.com/app");
    assert.deepEqual(response.body.result.value.captures, [
      {
        request: {
          url: "https://api.example.com/profile",
          method: "GET",
          resource_type: "fetch",
          headers: {
            accept: "application/json",
          },
        },
        response: {
          url: "https://api.example.com/profile",
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      },
      {
        request: {
          url: "https://api.example.com/data",
          method: "POST",
          resource_type: "xhr",
          headers: {
            authorization: "Bearer secret",
            "x-trace-id": "trace-1",
          },
        },
        response: {
          url: "https://api.example.com/data",
          status: 201,
          headers: {
            "content-type": "application/json",
          },
        },
      },
    ]);
  } finally {
    await worker.close();
  }
});

test("request capture matches exact and regex url filters", async () => {
  const worker = await startWorker({
    browserHook(browser) {
      browser.hooks.beforeOperation = async ({ kind, page }) => {
        if (kind === "goto") {
          page.emitRequest({
            url: "https://api.example.com/bootstrap",
            method: "GET",
            resourceType: "fetch",
            headers: {
              accept: "application/json",
            },
            response: {
              url: "https://api.example.com/bootstrap",
              status: 200,
              headers: { "content-type": "application/json" },
            },
          });
          page.emitRequest({
            url: "https://api.example.com/log",
            method: "POST",
            resourceType: "xhr",
            headers: {
              "content-type": "application/json",
            },
            response: {
              url: "https://api.example.com/log",
              status: 202,
              headers: { "x-accepted": "yes" },
            },
          });
        }
      };
    },
  });
  try {
    const startResponse = await postJson(worker.baseUrl, "/v1/commands", {
      task_id: "task-a",
      session_id: "session-a",
      command: {
        type: "start_request_capture",
        matchers: [
          {
            url: "https://api.example.com/bootstrap",
            resource_types: ["fetch"],
          },
          {
            url_regex: "^https://api\\.example\\.com/log$",
            method: "POST",
            resource_types: ["xhr"],
          },
        ],
      },
      required_checks: [],
    });
    const captureId = startResponse.body.result.value.capture_id;

    await postJson(worker.baseUrl, "/v1/commands", {
      task_id: "task-a",
      session_id: "session-a",
      command: {
        type: "goto",
        url: "https://example.com/app",
      },
      required_checks: [],
    });

    const response = await postJson(worker.baseUrl, "/v1/commands", {
      task_id: "task-a",
      session_id: "session-a",
      command: {
        type: "collect_captured_requests",
        capture_id: captureId,
        timeout_ms: 5_000,
      },
      required_checks: [],
    });

    assert.equal(response.response.status, 200);
    assert.equal(response.body.status, "ok");
    assert.equal(response.body.result.value.captures[0].request.resource_type, "fetch");
    assert.equal(response.body.result.value.captures[1].request.resource_type, "xhr");
    assert.equal(response.body.result.value.captures[0].response.status, 200);
    assert.equal(response.body.result.value.captures[1].response.status, 202);
  } finally {
    await worker.close();
  }
});

test("request capture ignores non-matching method and url", async () => {
  const worker = await startWorker({
    browserHook(browser) {
      browser.hooks.beforeOperation = async ({ kind, page }) => {
        if (kind === "goto") {
          page.emitRequest({
            url: "https://api.example.com/other",
            method: "POST",
            resourceType: "xhr",
            headers: { "x-ignored": "1" },
            response: {
              url: "https://api.example.com/other",
              status: 200,
              headers: {},
            },
          });
          page.emitRequest({
            url: "https://api.example.com/data",
            method: "GET",
            resourceType: "xhr",
            headers: { "x-ignored": "2" },
            response: {
              url: "https://api.example.com/data",
              status: 200,
              headers: {},
            },
          });
          page.emitRequest({
            url: "https://api.example.com/data",
            method: "POST",
            resourceType: "xhr",
            headers: { "x-match": "ok" },
            response: {
              url: "https://api.example.com/data",
              status: 200,
              headers: { "content-type": "text/plain" },
            },
          });
        }
      };
    },
  });
  try {
    const startResponse = await postJson(worker.baseUrl, "/v1/commands", {
      task_id: "task-a",
      session_id: "session-a",
      command: {
        type: "start_request_capture",
        matchers: [
          {
            url: "https://api.example.com/data",
            method: "POST",
            resource_types: ["xhr"],
          },
        ],
      },
      required_checks: [],
    });
    const captureId = startResponse.body.result.value.capture_id;

    await postJson(worker.baseUrl, "/v1/commands", {
      task_id: "task-a",
      session_id: "session-a",
      command: {
        type: "goto",
        url: "https://example.com/app",
      },
      required_checks: [],
    });

    const response = await postJson(worker.baseUrl, "/v1/commands", {
      task_id: "task-a",
      session_id: "session-a",
      command: {
        type: "collect_captured_requests",
        capture_id: captureId,
        timeout_ms: 5_000,
      },
      required_checks: [],
    });

    assert.equal(response.body.status, "ok");
    assert.deepEqual(response.body.result.value.captures[0].request.headers, { "x-match": "ok" });
    assert.equal(response.body.result.value.captures[0].response.status, 200);
  } finally {
    await worker.close();
  }
});

test("request capture supports overlapping handles", async () => {
  const worker = await startWorker({
    browserHook(browser) {
      browser.hooks.beforeOperation = async ({ kind, page }) => {
        if (kind === "goto") {
          page.emitRequest({
            url: "https://api.example.com/data",
            method: "POST",
            resourceType: "xhr",
            headers: { shared: "true" },
            response: {
              url: "https://api.example.com/data",
              status: 200,
              headers: {},
            },
          });
        }
      };
    },
  });
  try {
    const firstStart = await postJson(worker.baseUrl, "/v1/commands", {
      task_id: "task-a",
      session_id: "session-a",
      command: {
        type: "start_request_capture",
        matchers: [{ url: "https://api.example.com/data", method: "POST" }],
      },
      required_checks: [],
    });
    const secondStart = await postJson(worker.baseUrl, "/v1/commands", {
      task_id: "task-a",
      session_id: "session-a",
      command: {
        type: "start_request_capture",
        matchers: [{ url_regex: "^https://api\\.example\\.com/data$" }],
      },
      required_checks: [],
    });

    await postJson(worker.baseUrl, "/v1/commands", {
      task_id: "task-a",
      session_id: "session-a",
      command: {
        type: "goto",
        url: "https://example.com/app",
      },
      required_checks: [],
    });

    const firstCollect = await postJson(worker.baseUrl, "/v1/commands", {
      task_id: "task-a",
      session_id: "session-a",
      command: {
        type: "collect_captured_requests",
        capture_id: firstStart.body.result.value.capture_id,
        timeout_ms: 100,
      },
      required_checks: [],
    });
    const secondCollect = await postJson(worker.baseUrl, "/v1/commands", {
      task_id: "task-a",
      session_id: "session-a",
      command: {
        type: "collect_captured_requests",
        capture_id: secondStart.body.result.value.capture_id,
        timeout_ms: 100,
      },
      required_checks: [],
    });

    assert.equal(firstCollect.body.status, "ok");
    assert.equal(secondCollect.body.status, "ok");
    assert.equal(firstCollect.body.result.value.captures.length, 1);
    assert.equal(secondCollect.body.result.value.captures.length, 1);
  } finally {
    await worker.close();
  }
});

test("request capture errors when collection times out", async () => {
  const worker = await startWorker();
  try {
    const startResponse = await postJson(worker.baseUrl, "/v1/commands", {
      task_id: "task-a",
      session_id: "session-a",
      command: {
        type: "start_request_capture",
        matchers: [{ url: "https://api.example.com/data" }],
      },
      required_checks: [],
    });
    const response = await postJson(worker.baseUrl, "/v1/commands", {
      task_id: "task-a",
      session_id: "session-a",
      command: {
        type: "collect_captured_requests",
        capture_id: startResponse.body.result.value.capture_id,
        timeout_ms: 100,
      },
      required_checks: [],
    });

    assert.equal(response.response.status, 200);
    assert.equal(response.body.status, "error");
    assert.equal(response.body.error.code, "request_capture_timed_out");
  } finally {
    await worker.close();
  }
});

test("request capture rejects empty matchers", async () => {
  const worker = await startWorker();
  try {
    const response = await postJson(worker.baseUrl, "/v1/commands", {
      task_id: "task-a",
      session_id: "session-a",
      command: {
        type: "start_request_capture",
        matchers: [],
      },
      required_checks: [],
    });

    assert.equal(response.response.status, 200);
    assert.equal(response.body.status, "error");
    assert.equal(response.body.error.code, "invalid_request");
  } finally {
    await worker.close();
  }
});

test("request capture handles are one-shot after collection", async () => {
  const worker = await startWorker({
    browserHook(browser) {
      browser.hooks.beforeOperation = async ({ kind, page }) => {
        if (kind === "goto") {
          page.emitRequest({
            url: "https://api.example.com/data",
            method: "GET",
            resourceType: "fetch",
            headers: {},
            response: {
              url: "https://api.example.com/data",
              status: 200,
              headers: {},
            },
          });
        }
      };
    },
  });
  try {
    const startResponse = await postJson(worker.baseUrl, "/v1/commands", {
      task_id: "task-a",
      session_id: "session-a",
      command: {
        type: "start_request_capture",
        matchers: [{ url: "https://api.example.com/data" }],
      },
      required_checks: [],
    });
    const captureId = startResponse.body.result.value.capture_id;

    await postJson(worker.baseUrl, "/v1/commands", {
      task_id: "task-a",
      session_id: "session-a",
      command: {
        type: "goto",
        url: "https://example.com/app",
      },
      required_checks: [],
    });

    const firstCollect = await postJson(worker.baseUrl, "/v1/commands", {
      task_id: "task-a",
      session_id: "session-a",
      command: {
        type: "collect_captured_requests",
        capture_id: captureId,
        timeout_ms: 100,
      },
      required_checks: [],
    });
    const secondCollect = await postJson(worker.baseUrl, "/v1/commands", {
      task_id: "task-a",
      session_id: "session-a",
      command: {
        type: "collect_captured_requests",
        capture_id: captureId,
        timeout_ms: 100,
      },
      required_checks: [],
    });

    assert.equal(firstCollect.body.status, "ok");
    assert.equal(secondCollect.body.status, "error");
    assert.equal(secondCollect.body.error.code, "request_capture_not_found");
  } finally {
    await worker.close();
  }
});

test("request capture stop is idempotent", async () => {
  const worker = await startWorker();
  try {
    const startResponse = await postJson(worker.baseUrl, "/v1/commands", {
      task_id: "task-a",
      session_id: "session-a",
      command: {
        type: "start_request_capture",
        matchers: [{ url: "https://api.example.com/data" }],
      },
      required_checks: [],
    });
    const captureId = startResponse.body.result.value.capture_id;

    const firstStop = await postJson(worker.baseUrl, "/v1/commands", {
      task_id: "task-a",
      session_id: "session-a",
      command: {
        type: "stop_request_capture",
        capture_id: captureId,
      },
      required_checks: [],
    });
    const secondStop = await postJson(worker.baseUrl, "/v1/commands", {
      task_id: "task-a",
      session_id: "session-a",
      command: {
        type: "stop_request_capture",
        capture_id: captureId,
      },
      required_checks: [],
    });

    assert.equal(firstStop.body.status, "ok");
    assert.equal(secondStop.body.status, "ok");
    assert.equal(firstStop.body.result.value.stopped, true);
    assert.equal(secondStop.body.result.value.stopped, true);
  } finally {
    await worker.close();
  }
});

test("commands for the same session are serialized", async () => {
  const gate = deferred();
  const events = [];
  const worker = await startWorker({
    browserHook(browser) {
      browser.hooks.beforeOperation = async ({ kind }) => {
        if (kind === "goto") {
          events.push("goto-start");
          await gate.promise;
          events.push("goto-end");
        }
        if (kind === "click") {
          events.push("click");
        }
      };
    },
  });
  try {
    const first = postJson(worker.baseUrl, "/v1/commands", {
      task_id: "task-a",
      session_id: "session-a",
      command: { type: "goto", url: "https://example.com/a" },
      required_checks: [],
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    const second = postJson(worker.baseUrl, "/v1/commands", {
      task_id: "task-a",
      session_id: "session-a",
      command: { type: "click", selector: "#submit" },
      required_checks: [],
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(events, ["goto-start"]);

    gate.resolve();
    await first;
    await second;

    assert.deepEqual(events, ["goto-start", "goto-end", "click"]);
  } finally {
    await worker.close();
  }
});
