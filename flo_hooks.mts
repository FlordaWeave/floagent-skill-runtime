// @ts-nocheck

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

declare global {
  var __flo_closeLocalBrowserServer: (() => void) | undefined;
}

// Local Node hook for Flo skill scripts.
//
// Why this exists:
// - production skill scripts run inside the Flo script runtime and import from `flo:runtime`
// - local Node runs do not have that runtime, so `node --import ./flo_hooks.mts ...`
//   installs a compatible testing surface and resolves `flo:runtime`
//
// What this is for:
// - lightweight local testing of skill TypeScript/JavaScript files
// - editor/tooling-friendly smoke tests with the checked-in `flo.d.ts`
// - optional execution of a local-only `__flo_main__()` export
// - opt-in local browser mocking via the Playwright worker HTTP server
//
// What this is not:
// - not the source of truth for the production runtime
// - not a full `agentd` execution environment
// - not a general mock runtime for task/tool APIs

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const defaultLocalBrowserTaskId = "local-node-task";
const defaultLocalBrowserSessionId = "local-node-session";
const floTaskMaxSpawnChildren = 32;
const localBrowserEnabled = process.env.FLO_LOCAL_BROWSER === "1";
const floRuntimeModuleUrl = "flo-runtime:module";
const mainScriptUrl = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
const isModuleLikeFormat = (format: string | null | undefined): boolean =>
  format === "module" || format === "module-typescript";
const nativeFetch = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : undefined;

const unsupported = (name: string): never => {
  throw new Error(
    `${name} is unavailable in the local Node flo hook. Run this script inside agentd or avoid calling this API in local tests.`,
  );
};

const taskContext = (): unknown => {
  const rawContext = process.env.FLO_TASK_CONTEXT_JSON;
  if (!rawContext || rawContext.trim() === "") {
    return {};
  }
  try {
    return JSON.parse(rawContext);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`FLO_TASK_CONTEXT_JSON must contain valid JSON: ${message}`);
  }
};

const localBrowserDisabled = (name: string): never => {
  throw new Error(
    `${name} is unavailable in the local Node flo hook unless FLO_LOCAL_BROWSER=1 is set.`,
  );
};

let localBrowserServer: { close?: () => void; address?: () => unknown; unref?: () => void } | undefined;
let localBrowserBaseUrl: string | undefined;
let localBrowserStartupPromise: Promise<string> | undefined;
let localBrowserShutdownInstalled = false;
const defaultStateTtlSeconds = 3600;
const fallbackLocalToolId = "local-node-tool";
const defaultLocalVfsRoot = path.join(repoRoot, ".tmp-flo-local-vfs");

const isVfsPath = (value: string): boolean => value.startsWith("task://") || value.startsWith("session://");

const utf8Encode = (value: string): number[] => {
  const text = String(value);
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    let codePoint = text.codePointAt(index)!;
    if (codePoint > 0xffff) {
      index += 1;
    }
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return bytes;
};

const utf8Decode = (bytes: number[]): string => {
  if (typeof TextDecoder === "function") {
    return new TextDecoder("utf-8", { fatal: false }).decode(Uint8Array.from(bytes));
  }

  let output = "";
  let index = 0;
  while (index < bytes.length) {
    const first = Number(bytes[index]);
    if ((first & 0x80) === 0) {
      output += String.fromCodePoint(first);
      index += 1;
      continue;
    }

    let needed = 0;
    let codePoint = 0;
    let minimum = 0;
    if ((first & 0xe0) === 0xc0) {
      needed = 1;
      codePoint = first & 0x1f;
      minimum = 0x80;
    } else if ((first & 0xf0) === 0xe0) {
      needed = 2;
      codePoint = first & 0x0f;
      minimum = 0x800;
    } else if ((first & 0xf8) === 0xf0) {
      needed = 3;
      codePoint = first & 0x07;
      minimum = 0x10000;
    } else {
      output += "\uFFFD";
      index += 1;
      continue;
    }

    if (index + needed >= bytes.length) {
      output += "\uFFFD";
      break;
    }

    let valid = true;
    for (let offset = 1; offset <= needed; offset += 1) {
      const next = Number(bytes[index + offset]);
      if ((next & 0xc0) !== 0x80) {
        valid = false;
        break;
      }
      codePoint = (codePoint << 6) | (next & 0x3f);
    }
    if (!valid || codePoint < minimum || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      output += "\uFFFD";
      index += 1;
      continue;
    }

    output += String.fromCodePoint(codePoint);
    index += needed + 1;
  }
  return output;
};

const normalizeBlobType = (value: unknown): string => (value == null ? "" : String(value).trim().toLowerCase());

class BlobPolyfill {
  _bytes: number[];
  _type: string;
  _floVfsPath: string | null;

  constructor(parts: unknown[] = [], options: { type?: string } = {}) {
    this._bytes = [];
    this._type = normalizeBlobType(options.type);
    this._floVfsPath = null;
    for (const part of parts) {
      this._bytes.push(...blobPartToBytes(part));
    }
  }

  get size(): number {
    return this._bytes.length;
  }

  get type(): string {
    return this._type;
  }

  async text(): Promise<string> {
    if (this._floVfsPath) {
      throw new TypeError("VFS-backed File content is only available during fetch upload");
    }
    return utf8Decode(this._bytes);
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    if (this._floVfsPath) {
      throw new TypeError("VFS-backed File content is only available during fetch upload");
    }
    const bytes = Uint8Array.from(this._bytes);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }

  slice(start = 0, end = this.size, contentType = ""): BlobPolyfill {
    const relativeStart = start < 0 ? Math.max(this.size + start, 0) : Math.min(start, this.size);
    const relativeEnd = end < 0 ? Math.max(this.size + end, 0) : Math.min(end, this.size);
    const span = Math.max(relativeEnd - relativeStart, 0);
    return new BlobPolyfill([this._bytes.slice(relativeStart, relativeStart + span)], {
      type: contentType,
    });
  }
}

class FilePolyfill extends BlobPolyfill {
  _name: string;
  _lastModified: number;

  constructor(parts: unknown[], name: string, options: { type?: string; lastModified?: number } = {}) {
    super(parts, options);
    this._name = String(name);
    this._lastModified = Number.isFinite(options.lastModified) ? Math.trunc(options.lastModified!) : Date.now();
  }

  get name(): string {
    return this._name;
  }

  get lastModified(): number {
    return this._lastModified;
  }
}

class FormDataPolyfill {
  _entries: Array<{ name: string; value: string | BlobPolyfill; filename?: string }>;

  constructor() {
    this._entries = [];
  }

  append(name: string, value: string | BlobPolyfill, filename?: string): void {
    this._entries.push(normalizeFormDataEntry(name, value, filename));
  }

  set(name: string, value: string | BlobPolyfill, filename?: string): void {
    const normalizedName = String(name);
    this.delete(normalizedName);
    this._entries.push(normalizeFormDataEntry(normalizedName, value, filename));
  }

  get(name: string): string | BlobPolyfill | null {
    const entry = this._entries.find((item) => item.name === String(name));
    return entry ? entry.value : null;
  }

  getAll(name: string): Array<string | BlobPolyfill> {
    return this._entries.filter((item) => item.name === String(name)).map((item) => item.value);
  }

  has(name: string): boolean {
    return this._entries.some((item) => item.name === String(name));
  }

  delete(name: string): void {
    this._entries = this._entries.filter((item) => item.name !== String(name));
  }

  entries(): IterableIterator<[string, string | BlobPolyfill]> {
    return this._entries.map((entry) => [entry.name, entry.value] as [string, string | BlobPolyfill])[Symbol.iterator]();
  }

  keys(): IterableIterator<string> {
    return this._entries.map((entry) => entry.name)[Symbol.iterator]();
  }

  values(): IterableIterator<string | BlobPolyfill> {
    return this._entries.map((entry) => entry.value)[Symbol.iterator]();
  }

  forEach(
    callback: (value: string | BlobPolyfill, key: string, parent: FormDataPolyfill) => void,
    thisArg?: unknown,
  ): void {
    for (const entry of this._entries) {
      callback.call(thisArg, entry.value, entry.name, this);
    }
  }

  [Symbol.iterator](): IterableIterator<[string, string | BlobPolyfill]> {
    return this.entries();
  }
}

const cloneBlobAsFile = (value: BlobPolyfill, filename: string): FilePolyfill => {
  const nextValue = new FilePolyfill(value._floVfsPath ? [] : [value], String(filename), {
    type: value.type,
    lastModified: value instanceof FilePolyfill ? value.lastModified : Date.now(),
  });
  if (value._floVfsPath) {
    nextValue._floVfsPath = value._floVfsPath;
  }
  return nextValue;
};

const blobPartToBytes = (value: unknown): number[] => {
  if (value instanceof BlobPolyfill) {
    if (value._floVfsPath) {
      throw new TypeError("VFS-backed File bodies are only supported inside FormData uploads");
    }
    return value._bytes.slice();
  }
  if (value instanceof ArrayBuffer) {
    return Array.from(new Uint8Array(value));
  }
  if (ArrayBuffer.isView(value)) {
    return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }
  return utf8Encode(String(value));
};

const normalizeFormDataEntry = (
  name: string,
  value: string | BlobPolyfill,
  filename?: string,
): { name: string; value: string | BlobPolyfill; filename?: string } => {
  if (value instanceof BlobPolyfill) {
    const normalizedValue = filename == null ? value : cloneBlobAsFile(value, filename);
    return {
      name: String(name),
      value: normalizedValue,
      filename: undefined,
    };
  }
  return {
    name: String(name),
    value: String(value),
  };
};

const basenameFromPath = (value: string): string => {
  const normalized = String(value).replace(/\/+$/, "");
  const slash = normalized.lastIndexOf("/");
  return slash === -1 ? normalized : normalized.slice(slash + 1);
};

const sanitizeMultipartDispositionValue = (value: string, field: string): string => {
  const normalized = String(value);
  if (/[\x00-\x1f\x7f]/.test(normalized)) {
    throw new TypeError(`${field} must not contain control characters`);
  }
  return normalized.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
};

const resolveLocalVfsFilesystemPath = (rawPath: string): string => {
  const value = String(rawPath).trim();
  if (!isVfsPath(value)) {
    throw new TypeError("flo.file requires a VFS path starting with task:// or session://");
  }
  const root = process.env.FLO_VFS_ROOT?.trim() || defaultLocalVfsRoot;
  const normalized = value
    .replace(/^task:\/\//, "")
    .replace(/^session:\/\//, "")
    .replace(/\\/g, "/");
  const workspaceRelative = path.posix.normalize(`/${normalized}`).slice(1);
  const segments = workspaceRelative.split("/").filter(Boolean);
  if (workspaceRelative === ".." || workspaceRelative.startsWith("../") || segments.some((segment) => segment === "..")) {
    throw new TypeError("flo.file does not allow path traversal");
  }
  if (value.startsWith("task://")) {
    return path.join(root, "sessions", defaultLocalBrowserSessionId, "tasks", defaultLocalBrowserTaskId, ...segments);
  }
  return path.join(root, "sessions", defaultLocalBrowserSessionId, ...segments);
};

const createVfsFile = (
  rawPath: string,
  options: { type?: string; name?: string; lastModified?: number } = {},
): FilePolyfill => {
  const normalizedPath = String(rawPath).trim();
  if (!isVfsPath(normalizedPath)) {
    throw new TypeError("flo.file requires a VFS path starting with task:// or session://");
  }
  const name =
    options.name == null || String(options.name).trim() === "" ? basenameFromPath(normalizedPath) : String(options.name);
  const file = new FilePolyfill([], name, options);
  file._floVfsPath = normalizedPath;
  return file;
};

const loadBlobBytes = (value: BlobPolyfill): Uint8Array => {
  if (value._floVfsPath) {
    return new Uint8Array(fs.readFileSync(resolveLocalVfsFilesystemPath(value._floVfsPath)));
  }
  return Uint8Array.from(value._bytes);
};

const serializeMultipartBody = (
  value: FormDataPolyfill,
): { body: Uint8Array; contentType: string } => {
  const boundary = `----flo-local-${crypto.randomBytes(12).toString("hex")}`;
  const bytes: number[] = [];
  const pushText = (text: string) => bytes.push(...utf8Encode(text));
  const pushBinary = (buffer: Uint8Array) => bytes.push(...Array.from(buffer));

  for (const entry of value._entries) {
    pushText(`--${boundary}\r\n`);
    if (typeof entry.value === "string") {
      const safeName = sanitizeMultipartDispositionValue(entry.name, "FormData field name");
      pushText(`Content-Disposition: form-data; name="${safeName}"\r\n\r\n`);
      pushText(entry.value);
      pushText("\r\n");
      continue;
    }
    const effectiveFilename = entry.filename ?? (entry.value instanceof FilePolyfill ? entry.value.name : "blob");
    const safeName = sanitizeMultipartDispositionValue(entry.name, "FormData field name");
    const safeFilename = sanitizeMultipartDispositionValue(effectiveFilename, "FormData filename");
    pushText(`Content-Disposition: form-data; name="${safeName}"; filename="${safeFilename}"\r\n`);
    if (entry.value.type) {
      pushText(`Content-Type: ${entry.value.type}\r\n`);
    }
    pushText("\r\n");
    pushBinary(loadBlobBytes(entry.value));
    pushText("\r\n");
  }
  pushText(`--${boundary}--\r\n`);
  return {
    body: Uint8Array.from(bytes),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
};

globalThis.Blob = BlobPolyfill as any;
globalThis.File = FilePolyfill as any;
globalThis.FormData = FormDataPolyfill as any;

if (nativeFetch) {
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const normalizedInput =
      input instanceof URL
        ? input.toString()
        : typeof Request !== "undefined" && input instanceof Request
          ? input
          : String(input);
    const normalizedInit = init ? { ...init } : undefined;
    if (normalizedInit?.body instanceof FormDataPolyfill) {
      const multipart = serializeMultipartBody(normalizedInit.body);
      normalizedInit.body = multipart.body as any;
      const headers = new Headers(normalizedInit.headers);
      headers.set("content-type", multipart.contentType);
      normalizedInit.headers = headers;
    } else if (normalizedInit?.body instanceof BlobPolyfill) {
      throw new TypeError("fetch currently supports Blob/File values only inside FormData bodies");
    }
    return nativeFetch(normalizedInput, normalizedInit);
  }) as typeof globalThis.fetch;
}

const localBrowserWorkerModulePath = (): string => {
  const override = process.env.FLO_LOCAL_BROWSER_WORKER_MODULE;
  if (override && override.trim() !== "") {
    return path.resolve(override);
  }
  return path.join(repoRoot, "workers", "playwright-worker", "src", "server.js");
};

const closeLocalBrowserServer = (): void => {
  const server = localBrowserServer;
  localBrowserServer = undefined;
  localBrowserBaseUrl = undefined;
  localBrowserStartupPromise = undefined;
  if (!server || typeof server.close !== "function") {
    return;
  }
  try {
    server.close();
  } catch {
    // Best effort shutdown during Node process teardown.
  }
};

globalThis.__flo_closeLocalBrowserServer = closeLocalBrowserServer;

const installLocalBrowserShutdown = (): void => {
  if (localBrowserShutdownInstalled) {
    return;
  }
  localBrowserShutdownInstalled = true;
  process.once("beforeExit", closeLocalBrowserServer);
  process.once("exit", closeLocalBrowserServer);
};

const startLocalBrowserServer = async (): Promise<string> => {
  if (localBrowserServer && localBrowserBaseUrl) {
    return localBrowserBaseUrl;
  }
  if (!localBrowserStartupPromise) {
    localBrowserStartupPromise = (async () => {
      const workerModulePath = localBrowserWorkerModulePath();
      let workerModule: { createPlaywrightWorker?: (options: { port: number }) => { server?: any } };
      try {
        workerModule = await import(pathToFileURL(workerModulePath).href);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Failed to import local browser worker module at ${workerModulePath}: ${message}`,
        );
      }
      if (!workerModule || typeof workerModule.createPlaywrightWorker !== "function") {
        throw new Error(
          `Local browser worker module at ${workerModulePath} must export createPlaywrightWorker(options)`,
        );
      }

      const worker = workerModule.createPlaywrightWorker({ port: 0 });
      if (!worker || !worker.server || typeof worker.server.listen !== "function") {
        throw new Error(
          `Local browser worker module at ${workerModulePath} returned an invalid worker server`,
        );
      }

      localBrowserServer = worker.server;
      installLocalBrowserShutdown();

      await new Promise<void>((resolve, reject) => {
        worker.server.once("error", reject);
        worker.server.listen(0, "127.0.0.1", () => {
          worker.server.off("error", reject);
          resolve();
        });
      }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (
          message.includes("Cannot find package 'playwright'") ||
          message.includes("Cannot find module 'playwright'") ||
          message.includes('Cannot find module "playwright"')
        ) {
          throw new Error(
            "Local browser mode requires the `playwright` package to be installed for workers/playwright-worker.",
          );
        }
        throw new Error(`Failed to start local browser worker server: ${message}`);
      });

      const address = worker.server.address();
      if (!address || typeof address !== "object" || typeof address.port !== "number") {
        throw new Error("Failed to resolve local browser worker listening address");
      }

      if (typeof worker.server.unref === "function") {
        worker.server.unref();
      }

      localBrowserBaseUrl = `http://127.0.0.1:${address.port}`;
      return localBrowserBaseUrl;
    })().catch((error) => {
      closeLocalBrowserServer();
      throw error;
    });
  }

  return localBrowserStartupPromise;
};

const localBrowserIdentity = () => ({
  task_id: defaultLocalBrowserTaskId,
  session_id: defaultLocalBrowserSessionId,
});

const localBrowserWorkerMessage = (body: unknown, status: number): string => {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const error = (body as { error?: unknown }).error;
    if (error && typeof error === "object" && !Array.isArray(error)) {
      const code = (error as { code?: unknown }).code;
      const message = (error as { message?: unknown }).message;
      const retryable = (error as { retryable?: unknown }).retryable;
      const renderedMessage = typeof message === "string" && message.trim() !== "" ? message : `HTTP ${status}`;
      const renderedCode = typeof code === "string" && code.trim() !== "" ? `${code}: ` : "";
      const renderedRetryable = retryable === true ? " (retryable)" : "";
      return `${renderedCode}${renderedMessage}${renderedRetryable}`;
    }
  }
  return `HTTP ${status}`;
};

const localBrowserRequest = async (pathname: string, payload: Record<string, unknown>) => {
  const baseUrl = await startLocalBrowserServer();
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...localBrowserIdentity(),
      ...payload,
    }),
  });
  let body;
  try {
    body = await response.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Local browser worker returned invalid JSON: ${message}`);
  }

  if (
    !response.ok ||
    (body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      (body as { status?: unknown }).status === "error")
  ) {
    const workerMessage = localBrowserWorkerMessage(body, response.status);
    throw new Error(`Local browser worker request failed: ${workerMessage}`);
  }

  return body;
};

const normalizeBrowserRunResponse = (response: any) => {
  if (response && typeof response === "object" && response.status === "ok") {
    return response.result;
  }
  return response;
};

const normalizeBrowserValueResponse = (response: any) => {
  const normalized = normalizeBrowserRunResponse(response);
  if (
    normalized &&
    typeof normalized === "object" &&
    !Array.isArray(normalized) &&
    normalized.value &&
    typeof normalized.value === "object" &&
    !Array.isArray(normalized.value)
  ) {
    return {
      current_url:
        Object.prototype.hasOwnProperty.call(normalized, "current_url") ? normalized.current_url : null,
      ...normalized.value,
    };
  }
  return normalized;
};

const browserRun = async (command: unknown) => {
  if (!localBrowserEnabled) {
    localBrowserDisabled("flo.browser.run");
  }
  return normalizeBrowserRunResponse(
    await localBrowserRequest("/v1/commands", { command }),
  );
};

const browserStartRequestCapture = async (matchers: unknown[]) => {
  if (!localBrowserEnabled) {
    localBrowserDisabled("flo.browser.startRequestCapture");
  }
  return normalizeBrowserValueResponse(
    await localBrowserRequest("/v1/commands", {
      command: { type: "start_request_capture", matchers },
    }),
  );
};

const browserCollectCapturedRequests = async (captureId: string, options?: { timeout_ms?: number }) => {
  if (!localBrowserEnabled) {
    localBrowserDisabled("flo.browser.collectCapturedRequests");
  }
  const timeoutMs =
    options && Object.prototype.hasOwnProperty.call(options, "timeout_ms")
      ? options.timeout_ms
      : undefined;
  return normalizeBrowserValueResponse(
    await localBrowserRequest("/v1/commands", {
      command: {
        type: "collect_captured_requests",
        capture_id: captureId,
        timeout_ms: timeoutMs,
      },
    }),
  );
};

const browserStopRequestCapture = async (captureId: string) => {
  if (!localBrowserEnabled) {
    localBrowserDisabled("flo.browser.stopRequestCapture");
  }
  return normalizeBrowserValueResponse(
    await localBrowserRequest("/v1/commands", {
      command: { type: "stop_request_capture", capture_id: captureId },
    }),
  );
};

const browserExportState = async () => {
  if (!localBrowserEnabled) {
    localBrowserDisabled("flo.browser.exportState");
  }
  const response = await localBrowserRequest("/v1/storage-state/export", {});
  return response.state;
};

const browserImportState = async (state: unknown) => {
  if (!localBrowserEnabled) {
    localBrowserDisabled("flo.browser.importState");
  }
  await localBrowserRequest("/v1/storage-state/import", { state });
};

const formatUnixTimestamp = (timestamp: number, format: string, timezone?: string) => {
  if (!Number.isInteger(timestamp)) {
    throw new TypeError("flo.time.formatUnixTimestamp requires integer `timestamp`");
  }
  if (typeof format !== "string" || format.trim() === "") {
    throw new TypeError("flo.time.formatUnixTimestamp requires non-empty `format`");
  }
  if (timezone !== undefined && (typeof timezone !== "string" || timezone.trim() === "")) {
    throw new TypeError("flo.time.formatUnixTimestamp requires non-empty `timezone`");
  }

  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("flo.time.formatUnixTimestamp invalid unix timestamp");
  }

  const effectiveTimezone = timezone ?? "UTC";
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: effectiveTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  const replacements: Record<string, string | undefined> = {
    "[year]": parts.year,
    "[month]": parts.month,
    "[day]": parts.day,
    "[hour]": parts.hour,
    "[minute]": parts.minute,
    "[second]": parts.second,
  };

  const rendered = format.replace(/\[(year|month|day|hour|minute|second)\]/g, (token) => {
    const value = replacements[token];
    if (value === undefined) {
      throw new TypeError(`flo.time.formatUnixTimestamp unsupported token: ${token}`);
    }
    return value;
  });

  if (/\[[^\]]+\]/.test(rendered)) {
    throw new TypeError("flo.time.formatUnixTimestamp contains unsupported format tokens");
  }

  return rendered;
};

let cachedVaultMocks: { profile: Record<string, unknown>; shared: Record<string, Record<string, unknown>> };
let loadedVaultMocks = false;
let cachedMockFile: {
  filePath?: string;
  raw: Record<string, unknown>;
  runtimeConfig: Record<string, string>;
  vault: { profile: Record<string, unknown>; shared: Record<string, Record<string, unknown>> };
  stateBindings: LocalStateBinding[];
  state: LocalStateScopes;
};
let loadedMockFile = false;

type LocalStateEntry = {
  value: unknown;
  revision: string;
  expires_at?: string;
};

type LocalStateScopeStore = Record<string, Record<string, LocalStateEntry>>;

type LocalStateScopes = {
  profile: LocalStateScopeStore;
  session: LocalStateScopeStore;
  task: LocalStateScopeStore;
  shared: LocalStateScopeStore;
};

type LocalStateBinding = {
  name: string;
  key_prefix: string;
  scope_kind: keyof LocalStateScopes;
  scope_id: string | undefined;
};

const emptyLocalStateScopes = (): LocalStateScopes => ({
  profile: {},
  session: {},
  task: {},
  shared: {},
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const cloneJsonValue = <T>(value: T): T =>
  value === undefined ? value : JSON.parse(JSON.stringify(value));

const validateStateEntry = (value: unknown, pathLabel: string): LocalStateEntry => {
  if (!isRecord(value)) {
    throw new Error(`${pathLabel} must be an object`);
  }
  if (typeof value.revision !== "string" || value.revision.trim() === "") {
    throw new Error(`${pathLabel}.revision must be a non-empty string`);
  }
  if (!Object.prototype.hasOwnProperty.call(value, "value")) {
    throw new Error(`${pathLabel}.value must be present`);
  }
  if (
    Object.prototype.hasOwnProperty.call(value, "expires_at") &&
    value.expires_at !== undefined &&
    value.expires_at !== null &&
    (typeof value.expires_at !== "string" || value.expires_at.trim() === "" || Number.isNaN(Date.parse(value.expires_at)))
  ) {
    throw new Error(`${pathLabel}.expires_at must be an ISO timestamp when provided`);
  }
  const entry: LocalStateEntry = {
    value: cloneJsonValue(value.value),
    revision: value.revision,
  };
  if (typeof value.expires_at === "string") {
    entry.expires_at = value.expires_at;
  }
  return entry;
};

const validateStateScopes = (value: unknown): LocalStateScopes => {
  if (value === undefined) {
    return emptyLocalStateScopes();
  }
  if (!isRecord(value)) {
    throw new Error("FLO_MOCKS_FILE `state` must be an object when provided");
  }

  const scopeNames = ["profile", "session", "task", "shared"] as const;
  const state = emptyLocalStateScopes();
  for (const scopeName of scopeNames) {
    const scopeValue = value[scopeName];
    if (scopeValue === undefined) {
      continue;
    }
    if (!isRecord(scopeValue)) {
      throw new Error(`FLO_MOCKS_FILE \`state.${scopeName}\` must be an object when provided`);
    }
    const normalizedScope: LocalStateScopeStore = {};
    for (const [scopeId, entriesValue] of Object.entries(scopeValue)) {
      if (!isRecord(entriesValue)) {
        throw new Error(`FLO_MOCKS_FILE \`state.${scopeName}.${scopeId}\` must be an object`);
      }
      const normalizedEntries: Record<string, LocalStateEntry> = {};
      for (const [stateKey, entryValue] of Object.entries(entriesValue)) {
        normalizedEntries[stateKey] = validateStateEntry(
          entryValue,
          `FLO_MOCKS_FILE state.${scopeName}.${scopeId}.${stateKey}`,
        );
      }
      normalizedScope[scopeId] = normalizedEntries;
    }
    state[scopeName] = normalizedScope;
  }
  return state;
};

const validateStateBindings = (value: unknown): LocalStateBinding[] => {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("FLO_MOCKS_FILE `state_bindings` must be an array when provided");
  }
  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`FLO_MOCKS_FILE \`state_bindings[${index}]\` must be an object`);
    }
    const name = requireNonEmptyString(
      item.name,
      `FLO_MOCKS_FILE state_bindings[${index}].name must be a non-empty string`,
    );
    const keyPrefix = requireNonEmptyString(
      item.key_prefix,
      `FLO_MOCKS_FILE state_bindings[${index}].key_prefix must be a non-empty string`,
    );
    const scopeKind = validateScopeKind(
      item.scope_kind,
      `FLO_MOCKS_FILE state_bindings[${index}].scope_kind`,
    );
    const scopeId =
      item.scope_id === undefined
        ? undefined
        : requireNonEmptyString(
            item.scope_id,
            `FLO_MOCKS_FILE state_bindings[${index}].scope_id must be a non-empty string`,
          );
    if (scopeKind === "shared") {
      if (scopeId === undefined) {
        throw new Error(
          `FLO_MOCKS_FILE state_bindings[${index}].scope_id is required for shared scope_kind`,
        );
      }
      return { name, key_prefix: keyPrefix, scope_kind: scopeKind, scope_id: scopeId };
    }
    if (scopeId !== undefined) {
      throw new Error(
        `FLO_MOCKS_FILE state_bindings[${index}].scope_id is only valid for shared scope_kind`,
      );
    }
    return { name, key_prefix: keyPrefix, scope_kind: scopeKind };
  });
};

const validateRuntimeConfigMocks = (value: unknown): Record<string, string> => {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new Error("FLO_MOCKS_FILE `runtime_config` must be an object when provided");
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => {
      if (typeof entryValue !== "string") {
        throw new Error(`FLO_MOCKS_FILE runtime_config.${key} must be a string`);
      }
      return [key, entryValue];
    }),
  );
};

const loadMockFile = () => {
  if (loadedMockFile) {
    return cachedMockFile;
  }

  loadedMockFile = true;
  const file = process.env.FLO_MOCKS_FILE;
  if (!file) {
    cachedMockFile = {
      raw: {},
      runtimeConfig: {},
      vault: { profile: {}, shared: {} },
      stateBindings: [],
      state: emptyLocalStateScopes(),
    };
    return cachedMockFile;
  }

  const resolvedPath = path.resolve(file);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Failed to read FLO_MOCKS_FILE at ${resolvedPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(parsed)) {
    throw new Error("FLO_MOCKS_FILE must contain a JSON object");
  }

  const vault = parsed.vault ?? {};
  if (!isRecord(vault)) {
    throw new Error("FLO_MOCKS_FILE `vault` must be an object when provided");
  }

  const profile = vault.profile ?? {};
  const shared = vault.shared ?? {};
  if (!isRecord(profile)) {
    throw new Error("FLO_MOCKS_FILE `vault.profile` must be an object when provided");
  }
  if (!isRecord(shared)) {
    throw new Error("FLO_MOCKS_FILE `vault.shared` must be an object when provided");
  }

  const normalizedShared: Record<string, Record<string, unknown>> = {};
  for (const [scopeId, scopeValue] of Object.entries(shared)) {
    if (!isRecord(scopeValue)) {
      throw new Error(`FLO_MOCKS_FILE \`vault.shared.${scopeId}\` must be an object`);
    }
    normalizedShared[scopeId] = scopeValue;
  }

  const runtimeConfig = validateRuntimeConfigMocks(parsed.runtime_config);
  const state = validateStateScopes(parsed.state);
  const stateBindings = validateStateBindings(parsed.state_bindings);
  cachedMockFile = {
    filePath: resolvedPath,
    raw: parsed,
    runtimeConfig,
    vault: { profile, shared: normalizedShared },
    stateBindings,
    state,
  };
  return cachedMockFile;
};

const persistMockFile = () => {
  const mockFile = loadMockFile();
  if (!mockFile.filePath) {
    return;
  }
  mockFile.raw.vault = {
    profile: mockFile.vault.profile,
    shared: mockFile.vault.shared,
  };
  mockFile.raw.runtime_config = mockFile.runtimeConfig;
  mockFile.raw.state_bindings = mockFile.stateBindings;
  mockFile.raw.state = mockFile.state;
  fs.writeFileSync(mockFile.filePath, `${JSON.stringify(mockFile.raw, null, 2)}\n`, "utf8");
};

const loadVaultMocks = () => {
  if (!loadedVaultMocks) {
    loadedVaultMocks = true;
    const mockFile = loadMockFile();
    cachedVaultMocks = mockFile.vault;
  }
  return cachedVaultMocks;
};

const validateScopeKind = (scope: unknown, name: string): keyof LocalStateScopes => {
  if (scope !== "profile" && scope !== "session" && scope !== "task" && scope !== "shared") {
    throw new TypeError(`${name} must be \`profile\`, \`session\`, \`task\`, or \`shared\``);
  }
  return scope;
};

const requireNonEmptyString = (value: unknown, message: string): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(message);
  }
  return value;
};

const parseOptionalTtlSeconds = (value: unknown, name: string): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new TypeError(`${name} requires integer \`ttl_seconds\` greater than zero`);
  }
  return Number(value);
};

const parseOptionalIfRevision = (value: unknown, name: string): string | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} requires non-empty string or null \`if_revision\``);
  }
  return value;
};

const parseOptionalLimit = (value: unknown): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new TypeError("flo.state.list requires integer `limit` greater than zero");
  }
  return Number(value);
};

const parseOptionalCursor = (value: unknown): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError("flo.state.list requires non-empty string `cursor` when provided");
  }
  return value;
};

const requireString = (value: unknown, message: string): string => {
  if (typeof value !== "string") {
    throw new TypeError(message);
  }
  return value;
};

const nowTimestampMs = () => Date.now();

const isExpiredEntry = (entry: LocalStateEntry, nowMs = nowTimestampMs()): boolean => {
  if (!entry.expires_at) {
    return false;
  }
  const expiresAtMs = Date.parse(entry.expires_at);
  return Number.isNaN(expiresAtMs) || expiresAtMs <= nowMs;
};

const defaultScopeIdForScopeKind = (scopeKind: Exclude<keyof LocalStateScopes, "shared">): string => {
  if (scopeKind === "profile") {
    return process.env.FLO_LOCAL_PROFILE_ID?.trim() || "local-node-profile";
  }
  if (scopeKind === "session") {
    return process.env.FLO_LOCAL_SESSION_ID?.trim() || defaultLocalBrowserSessionId;
  }
  return process.env.FLO_LOCAL_TASK_ID?.trim() || defaultLocalBrowserTaskId;
};

const resolveLocalStateBinding = (
  request: Record<string, unknown>,
  key: string,
  apiName: string,
): LocalStateBinding => {
  const scopeKind = validateScopeKind(request.scope_kind, `${apiName} scope_kind`);
  const matches = loadMockFile().stateBindings.filter(
    (binding) => binding.scope_kind === scopeKind && key.startsWith(binding.key_prefix),
  );
  if (matches.length === 0) {
    throw new TypeError(
      `state key \`${key}\` is not allowed by any local binding for scope_kind \`${scopeKind}\``,
    );
  }
  if (matches.length > 1) {
    throw new TypeError(
      `state key \`${key}\` matches multiple local bindings for scope_kind \`${scopeKind}\``,
    );
  }
  return matches[0];
};

const resolveStateScopeId = (
  request: Record<string, unknown>,
  binding: LocalStateBinding,
  name: string,
): string => {
  if (binding.scope_kind === "shared") {
    if (Object.prototype.hasOwnProperty.call(request, "scope_id")) {
      throw new TypeError(`${name} does not accept \`scope_id\``);
    }
    return binding.scope_id ?? (() => {
      throw new TypeError(`${name} requires manifest-configured shared scope_id`);
    })();
  }

  if (Object.prototype.hasOwnProperty.call(request, "scope_id") && request.scope_id !== undefined) {
    throw new TypeError(`${name} does not accept \`scope_id\` for non-shared scope_kind`);
  }

  return defaultScopeIdForScopeKind(binding.scope_kind);
};

const ensureStateBucket = (scope: keyof LocalStateScopes, scopeId: string): Record<string, LocalStateEntry> => {
  const state = loadMockFile().state;
  const scopeStore = state[scope];
  scopeStore[scopeId] ??= {};
  return scopeStore[scopeId];
};

const maybeStateBucket = (scope: keyof LocalStateScopes, scopeId: string): Record<string, LocalStateEntry> | undefined =>
  loadMockFile().state[scope][scopeId];

const purgeExpiredEntries = (scope: keyof LocalStateScopes, scopeId: string, keyPrefix?: string): boolean => {
  const bucket = maybeStateBucket(scope, scopeId);
  if (!bucket) {
    return false;
  }
  const nowMs = nowTimestampMs();
  let changed = false;
  for (const [key, entry] of Object.entries(bucket)) {
    if (keyPrefix && !key.startsWith(keyPrefix)) {
      continue;
    }
    if (isExpiredEntry(entry, nowMs)) {
      delete bucket[key];
      changed = true;
    }
  }
  if (Object.keys(bucket).length === 0) {
    delete loadMockFile().state[scope][scopeId];
    changed = true;
  }
  return changed;
};

const normalizeStateEntry = (key: string, entry: LocalStateEntry) => {
  const normalized: Record<string, unknown> = {
    key,
    value: cloneJsonValue(entry.value),
    revision: entry.revision,
  };
  if (entry.expires_at) {
    normalized.expires_at = entry.expires_at;
  }
  return normalized;
};

const currentLocalToolId = (): string => {
  const explicit = process.env.FLO_LOCAL_TOOL_ID?.trim();
  if (explicit) {
    return explicit;
  }
  if (mainScriptUrl?.startsWith("file:")) {
    const parsed = path.parse(fileURLToPath(mainScriptUrl));
    if (parsed.name.trim() !== "") {
      return parsed.name;
    }
  }
  return fallbackLocalToolId;
};

const taskStateReservedKey = (key: string) => `__flo.task.state/${key}`;
const toolStateReservedKey = (toolId: string, key: string) => `__flo.task.tool_state/${toolId}/${key}`;

const getLocalStateEntry = (scopeKind: keyof LocalStateScopes, scopeId: string, key: string) => {
  if (purgeExpiredEntries(scopeKind, scopeId, key)) {
    persistMockFile();
  }
  const entry = maybeStateBucket(scopeKind, scopeId)?.[key];
  return entry ? normalizeStateEntry(key, entry) : null;
};

const listLocalStateEntries = (
  scopeKind: keyof LocalStateScopes,
  scopeId: string,
  keyPrefix: string,
  limit?: number,
  cursor?: string,
) => {
  if (purgeExpiredEntries(scopeKind, scopeId, keyPrefix)) {
    persistMockFile();
  }
  const bucket = maybeStateBucket(scopeKind, scopeId) ?? {};
  const keys = Object.keys(bucket)
    .filter((key) => key.startsWith(keyPrefix) && (!cursor || key > cursor))
    .sort((left, right) => left.localeCompare(right));
  const selectedKeys = limit === undefined ? keys : keys.slice(0, limit);
  return {
    entries: selectedKeys.map((key) => normalizeStateEntry(key, bucket[key])),
    next_cursor: limit !== undefined && keys.length > selectedKeys.length ? selectedKeys[selectedKeys.length - 1] : undefined,
  };
};

const putLocalStateEntry = (
  scopeKind: keyof LocalStateScopes,
  scopeId: string,
  key: string,
  value: unknown,
  ttlSeconds: number,
  ifRevision: string | null | undefined,
) => {
  if (purgeExpiredEntries(scopeKind, scopeId, key)) {
    persistMockFile();
  }
  const bucket = ensureStateBucket(scopeKind, scopeId);
  const existing = bucket[key];
  if (ifRevision === null && existing) {
    return { ok: false, conflict_revision: existing.revision };
  }
  if (typeof ifRevision === "string" && (!existing || existing.revision !== ifRevision)) {
    return { ok: false, conflict_revision: existing?.revision };
  }
  const entry: LocalStateEntry = {
    value: cloneJsonValue(value),
    revision: crypto.randomUUID(),
    expires_at: new Date(nowTimestampMs() + ttlSeconds * 1000).toISOString(),
  };
  bucket[key] = entry;
  persistMockFile();
  return {
    ok: true,
    entry: normalizeStateEntry(key, entry),
  };
};

const applyLocalJsonMergePatch = (target: unknown, patch: unknown): unknown => {
  if (!isRecord(patch)) {
    return cloneJsonValue(patch);
  }
  const base = isRecord(target) ? cloneJsonValue(target) as Record<string, unknown> : {};
  for (const [key, patchValue] of Object.entries(patch)) {
    if (patchValue === null) {
      delete base[key];
      continue;
    }
    base[key] = applyLocalJsonMergePatch(base[key], patchValue);
  }
  return base;
};

const patchLocalStateEntry = (
  scopeKind: keyof LocalStateScopes,
  scopeId: string,
  key: string,
  patch: Record<string, unknown>,
  ttlSeconds: number,
  ifRevision: string | null | undefined,
) => {
  if (purgeExpiredEntries(scopeKind, scopeId, key)) {
    persistMockFile();
  }
  const existing = maybeStateBucket(scopeKind, scopeId)?.[key];
  if (ifRevision === null && existing) {
    return { ok: false, conflict_revision: existing.revision };
  }
  if (typeof ifRevision === "string" && (!existing || existing.revision !== ifRevision)) {
    return { ok: false, conflict_revision: existing?.revision };
  }
  const nextValue = applyLocalJsonMergePatch(existing?.value, patch);
  return putLocalStateEntry(scopeKind, scopeId, key, nextValue, ttlSeconds, undefined);
};

const appendLocalStateEntry = (
  scopeKind: keyof LocalStateScopes,
  scopeId: string,
  key: string,
  item: unknown,
  ttlSeconds: number,
  ifRevision: string | null | undefined,
) => {
  if (purgeExpiredEntries(scopeKind, scopeId, key)) {
    persistMockFile();
  }
  const existing = maybeStateBucket(scopeKind, scopeId)?.[key];
  if (ifRevision === null && existing) {
    return { ok: false, conflict_revision: existing.revision };
  }
  if (typeof ifRevision === "string" && (!existing || existing.revision !== ifRevision)) {
    return { ok: false, conflict_revision: existing?.revision };
  }
  if (existing && !Array.isArray(existing.value)) {
    throw new TypeError("flo.state.append requires the current value to be an array");
  }
  const nextValue = Array.isArray(existing?.value) ? [...existing.value, cloneJsonValue(item)] : [cloneJsonValue(item)];
  return putLocalStateEntry(scopeKind, scopeId, key, nextValue, ttlSeconds, undefined);
};

const deleteLocalStateEntry = (
  scopeKind: keyof LocalStateScopes,
  scopeId: string,
  key: string,
  ifRevision: string | null | undefined,
) => {
  if (purgeExpiredEntries(scopeKind, scopeId, key)) {
    persistMockFile();
  }
  const bucket = maybeStateBucket(scopeKind, scopeId);
  const existing = bucket?.[key];
  if (ifRevision === null) {
    return { ok: false, conflict_revision: existing?.revision };
  }
  if (typeof ifRevision === "string" && (!existing || existing.revision !== ifRevision)) {
    return { ok: false, conflict_revision: existing?.revision };
  }
  if (!existing) {
    return { ok: false };
  }
  delete bucket[key];
  if (bucket && Object.keys(bucket).length === 0) {
    delete loadMockFile().state[scopeKind][scopeId];
  }
  persistMockFile();
  return { ok: true };
};

const stateGet = async (request: unknown) => {
  if (!isRecord(request)) {
    throw new TypeError("flo.state.get requires an object request");
  }
  const key = requireNonEmptyString(request.key, "flo.state.get requires non-empty `key`");
  const binding = resolveLocalStateBinding(request, key, "flo.state.get");
  const scopeId = resolveStateScopeId(request, binding, "flo.state.get");
  return getLocalStateEntry(binding.scope_kind, scopeId, key);
};

const stateList = async (request: unknown) => {
  if (!isRecord(request)) {
    throw new TypeError("flo.state.list requires an object request");
  }
  const keyPrefix = requireString(request.key_prefix, "flo.state.list requires string `key_prefix`");
  const limit = parseOptionalLimit(request.limit);
  const cursor = parseOptionalCursor(request.cursor);
  const binding = resolveLocalStateBinding(request, keyPrefix, "flo.state.list");
  const scopeId = resolveStateScopeId(request, binding, "flo.state.list");
  return listLocalStateEntries(binding.scope_kind, scopeId, keyPrefix, limit, cursor);
};

const statePut = async (request: unknown) => {
  if (!isRecord(request)) {
    throw new TypeError("flo.state.put requires an object request");
  }
  const key = requireNonEmptyString(request.key, "flo.state.put requires non-empty `key`");
  if (!Object.prototype.hasOwnProperty.call(request, "value")) {
    throw new TypeError("flo.state.put requires `value`");
  }
  const ttlSeconds = parseOptionalTtlSeconds(request.ttl_seconds, "flo.state.put") ?? defaultStateTtlSeconds;
  const ifRevision = parseOptionalIfRevision(request.if_revision, "flo.state.put");
  const binding = resolveLocalStateBinding(request, key, "flo.state.put");
  const scopeId = resolveStateScopeId(request, binding, "flo.state.put");
  return putLocalStateEntry(binding.scope_kind, scopeId, key, request.value, ttlSeconds, ifRevision);
};

const statePatch = async (request: unknown) => {
  if (!isRecord(request)) {
    throw new TypeError("flo.state.patch requires an object request");
  }
  const key = requireNonEmptyString(request.key, "flo.state.patch requires non-empty `key`");
  if (!isRecord(request.patch)) {
    throw new TypeError("flo.state.patch requires object `patch`");
  }
  const ttlSeconds = parseOptionalTtlSeconds(request.ttl_seconds, "flo.state.patch") ?? defaultStateTtlSeconds;
  const ifRevision = parseOptionalIfRevision(request.if_revision, "flo.state.patch");
  const binding = resolveLocalStateBinding(request, key, "flo.state.patch");
  const scopeId = resolveStateScopeId(request, binding, "flo.state.patch");
  return patchLocalStateEntry(binding.scope_kind, scopeId, key, request.patch, ttlSeconds, ifRevision);
};

const stateAppend = async (request: unknown) => {
  if (!isRecord(request)) {
    throw new TypeError("flo.state.append requires an object request");
  }
  const key = requireNonEmptyString(request.key, "flo.state.append requires non-empty `key`");
  if (!Object.prototype.hasOwnProperty.call(request, "item")) {
    throw new TypeError("flo.state.append requires `item`");
  }
  const ttlSeconds = parseOptionalTtlSeconds(request.ttl_seconds, "flo.state.append") ?? defaultStateTtlSeconds;
  const ifRevision = parseOptionalIfRevision(request.if_revision, "flo.state.append");
  const binding = resolveLocalStateBinding(request, key, "flo.state.append");
  const scopeId = resolveStateScopeId(request, binding, "flo.state.append");
  return appendLocalStateEntry(binding.scope_kind, scopeId, key, request.item, ttlSeconds, ifRevision);
};

const stateDelete = async (request: unknown) => {
  if (!isRecord(request)) {
    throw new TypeError("flo.state.delete requires an object request");
  }
  const key = requireNonEmptyString(request.key, "flo.state.delete requires non-empty `key`");
  const ifRevision = parseOptionalIfRevision(request.if_revision, "flo.state.delete");
  const binding = resolveLocalStateBinding(request, key, "flo.state.delete");
  const scopeId = resolveStateScopeId(request, binding, "flo.state.delete");
  return deleteLocalStateEntry(binding.scope_kind, scopeId, key, ifRevision);
};

const taskStateGet = async (request: unknown) => {
  if (!isRecord(request)) {
    throw new TypeError("flo.task.getState requires an object request");
  }
  const key = requireNonEmptyString(request.key, "flo.task.getState requires non-empty `key`");
  const entry = getLocalStateEntry(
    "task",
    process.env.FLO_LOCAL_TASK_ID?.trim() || defaultLocalBrowserTaskId,
    taskStateReservedKey(key),
  );
  return entry ? entry.value : null;
};

const taskStatePut = async (request: unknown) => {
  if (!isRecord(request)) {
    throw new TypeError("flo.task.putState requires an object request");
  }
  const key = requireNonEmptyString(request.key, "flo.task.putState requires non-empty `key`");
  if (!Object.prototype.hasOwnProperty.call(request, "value")) {
    throw new TypeError("flo.task.putState requires `value`");
  }
  const ttlSeconds = parseOptionalTtlSeconds(request.ttl_seconds, "flo.task.putState") ?? defaultStateTtlSeconds;
  const ifRevision = parseOptionalIfRevision(request.if_revision, "flo.task.putState");
  return putLocalStateEntry(
    "task",
    process.env.FLO_LOCAL_TASK_ID?.trim() || defaultLocalBrowserTaskId,
    taskStateReservedKey(key),
    request.value,
    ttlSeconds,
    ifRevision,
  );
};

const taskToolStateGet = async (request: unknown) => {
  if (!isRecord(request)) {
    throw new TypeError("flo.task.getToolState requires an object request");
  }
  const key = requireNonEmptyString(request.key, "flo.task.getToolState requires non-empty `key`");
  const toolId = request.tool_id === undefined ? currentLocalToolId() : requireNonEmptyString(
    request.tool_id,
    "flo.task.getToolState requires non-empty `tool_id` when provided",
  );
  const entry = getLocalStateEntry(
    "task",
    process.env.FLO_LOCAL_TASK_ID?.trim() || defaultLocalBrowserTaskId,
    toolStateReservedKey(toolId, key),
  );
  return entry ? entry.value : null;
};

const taskToolStatePut = async (request: unknown) => {
  if (!isRecord(request)) {
    throw new TypeError("flo.task.putToolState requires an object request");
  }
  const key = requireNonEmptyString(request.key, "flo.task.putToolState requires non-empty `key`");
  if (!Object.prototype.hasOwnProperty.call(request, "value")) {
    throw new TypeError("flo.task.putToolState requires `value`");
  }
  const toolId = request.tool_id === undefined ? currentLocalToolId() : requireNonEmptyString(
    request.tool_id,
    "flo.task.putToolState requires non-empty `tool_id` when provided",
  );
  const ttlSeconds = parseOptionalTtlSeconds(request.ttl_seconds, "flo.task.putToolState") ?? defaultStateTtlSeconds;
  const ifRevision = parseOptionalIfRevision(request.if_revision, "flo.task.putToolState");
  return putLocalStateEntry(
    "task",
    process.env.FLO_LOCAL_TASK_ID?.trim() || defaultLocalBrowserTaskId,
    toolStateReservedKey(toolId, key),
    request.value,
    ttlSeconds,
    ifRevision,
  );
};

const taskProfileGet = async () => ({
  profile_id: process.env.FLO_LOCAL_PROFILE_ID?.trim() || "local-node-profile",
  profile_kind: "user",
  permissions: [],
  display_name: process.env.FLO_LOCAL_PROFILE_DISPLAY_NAME?.trim() || undefined,
});

const vaultGet = async (request: any) => {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new TypeError("flo.vault.get requires an object request");
  }

  const { scope, key } = request;
  if (scope !== "profile" && scope !== "shared") {
    throw new TypeError("flo.vault.get scope must be `profile` or `shared`");
  }
  if (typeof key !== "string" || key.trim() === "") {
    throw new TypeError("flo.vault.get requires non-empty `key`");
  }

  const mocks = loadVaultMocks();
  if (scope === "profile") {
    if (!Object.prototype.hasOwnProperty.call(mocks.profile, key)) {
      throw new Error(`No profile vault mock found for key "${key}"`);
    }
    return String(mocks.profile[key]);
  }

  const { scope_id: scopeId } = request;
  if (typeof scopeId !== "string" || scopeId.trim() === "") {
    throw new TypeError("flo.vault.get requires non-empty `scope_id` for shared scope");
  }
  const sharedScope = mocks.shared[scopeId];
  if (!sharedScope || typeof sharedScope !== "object" || Array.isArray(sharedScope)) {
    throw new Error(`No shared vault mock scope found for scope_id "${scopeId}"`);
  }
  if (!Object.prototype.hasOwnProperty.call(sharedScope, key)) {
    throw new Error(`No shared vault mock found for scope_id "${scopeId}" and key "${key}"`);
  }
  return String(sharedScope[key]);
};

const getRuntimeConfig = async (key: unknown): Promise<string | undefined> => {
  if (typeof key !== "string" || key.trim() === "") {
    throw new TypeError("flo.getRuntimeConfig requires non-empty `key`");
  }
  const normalizedKey = key.trim();
  const mockFile = loadMockFile();
  return Object.prototype.hasOwnProperty.call(mockFile.runtimeConfig, normalizedKey)
    ? mockFile.runtimeConfig[normalizedKey]
    : undefined;
};

globalThis.__flo_runtime = {
  sleep: async (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    }),
  getRuntimeConfig,
  time: {
    formatUnixTimestamp,
  },
  vault: {
    get: vaultGet,
  },
  state: {
    get: stateGet,
    list: stateList,
    put: statePut,
    patch: statePatch,
    append: stateAppend,
    delete: stateDelete,
  },
  task: {
    limits: {
      maxSpawnChildren: floTaskMaxSpawnChildren,
    },
    getState: taskStateGet,
    putState: taskStatePut,
    getToolState: taskToolStateGet,
    putToolState: taskToolStatePut,
    getProfile: taskProfileGet,
    getContext: async () => taskContext(),
    emitEvent: async (request: unknown) => {
      console.log(request);
    },
    spawnChildren: async (_request: unknown) => unsupported("flo.task.spawnChildren"),
    waitForBatch: async () => unsupported("flo.task.waitForBatch"),
    waitForUserMessage: async () => unsupported("flo.task.waitForUserMessage"),
    getBatchResults: async () => unsupported("flo.task.getBatchResults"),
  },
  dispatcher: {
    syncSubjects: async (_request: unknown) => unsupported("flo.dispatcher.syncSubjects"),
    claimDueSubjects: async (_request: unknown) => unsupported("flo.dispatcher.claimDueSubjects"),
    checkpointSubject: async (_request: unknown) => unsupported("flo.dispatcher.checkpointSubject"),
    completeSubject: async (_request: unknown) => unsupported("flo.dispatcher.completeSubject"),
    failSubject: async (_request: unknown) => unsupported("flo.dispatcher.failSubject"),
    releaseSubject: async (_request: unknown) => unsupported("flo.dispatcher.releaseSubject"),
  },
  callTool: async () => unsupported("flo.callTool"),
  file: createVfsFile,
  browser: {
    run: browserRun,
    startRequestCapture: browserStartRequestCapture,
    collectCapturedRequests: browserCollectCapturedRequests,
    stopRequestCapture: browserStopRequestCapture,
    exportState: browserExportState,
    importState: browserImportState,
  },
};

const runtimeModuleSource = `
const runtime = globalThis.__flo_runtime;
if (!runtime) {
  throw new Error("flo:runtime is unavailable because the local Node Flo hook was not installed");
}
export const sleep = runtime.sleep;
export const getRuntimeConfig = runtime.getRuntimeConfig;
export const time = runtime.time;
export const vault = runtime.vault;
export const state = runtime.state;
export const task = runtime.task;
export const dispatcher = runtime.dispatcher;
export const callTool = runtime.callTool;
export const file = runtime.file;
export const browser = runtime.browser;
`;

const entrypointFooter = `
if (typeof __flo_main__ !== "undefined") {
  try {
    if (typeof __flo_main__ !== "function") {
      throw new TypeError("Module export __flo_main__ must be a function");
    }
    if (__flo_main__.length !== 0) {
      throw new TypeError("Module export __flo_main__ must not declare input parameters");
    }
    const __floResult = await __flo_main__();
    if (__floResult !== undefined) {
      process.stdout.write(JSON.stringify(__floResult, null, 2) + "\\n");
    }
  } finally {
    globalThis.__flo_closeLocalBrowserServer?.();
  }
}
`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "flo:runtime") {
      return {
        shortCircuit: true,
        url: floRuntimeModuleUrl,
        format: "module",
      };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === floRuntimeModuleUrl) {
      return {
        shortCircuit: true,
        format: "module",
        source: runtimeModuleSource,
      };
    }

    const result = nextLoad(url, context);
    if (!isModuleLikeFormat(result.format)) {
      return result;
    }

    let source: string | null = null;
    if (typeof result.source === "string") {
      source = result.source;
    } else if (result.source) {
      source = Buffer.from(result.source).toString("utf8");
    } else if (url.startsWith("file:")) {
      source = fs.readFileSync(fileURLToPath(url), "utf8");
    }
    if (source === null) {
      return result;
    }

    if (!mainScriptUrl || url !== mainScriptUrl) {
      return {
        ...result,
        source,
      };
    }

    return {
      ...result,
      source: `${source}\n${entrypointFooter}`,
    };
  },
});
