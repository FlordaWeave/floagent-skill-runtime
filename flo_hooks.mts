// @ts-nocheck

import fs from "node:fs";
import path from "node:path";
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

if (nativeFetch) {
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const normalizedInput =
      input instanceof URL
        ? input.toString()
        : typeof Request !== "undefined" && input instanceof Request
          ? input
          : String(input);
    return nativeFetch(normalizedInput, init);
  };
}

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

  if (!response.ok) {
    const workerMessage =
      body && typeof body === "object" && body.error && typeof body.error.message === "string"
        ? body.error.message
        : `HTTP ${response.status}`;
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

const browserRun = async (command: unknown, options?: { required_checks?: unknown[] }) => {
  if (!localBrowserEnabled) {
    localBrowserDisabled("flo.browser.run");
  }
  return normalizeBrowserRunResponse(
    await localBrowserRequest("/v1/commands", {
      command,
      required_checks: Array.isArray(options?.required_checks) ? options.required_checks : [],
    }),
  );
};

const browserStartRequestCapture = async (matchers: unknown[], options?: { required_checks?: unknown[] }) => {
  if (!localBrowserEnabled) {
    localBrowserDisabled("flo.browser.startRequestCapture");
  }
  return normalizeBrowserValueResponse(
    await localBrowserRequest("/v1/commands", {
      command: { type: "start_request_capture", matchers },
      required_checks: Array.isArray(options?.required_checks) ? options.required_checks : [],
    }),
  );
};

const browserCollectCapturedRequests = async (
  captureId: string,
  options?: { required_checks?: unknown[]; timeout_ms?: number },
) => {
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
      required_checks: Array.isArray(options?.required_checks) ? options.required_checks : [],
    }),
  );
};

const browserStopRequestCapture = async (captureId: string, options?: { required_checks?: unknown[] }) => {
  if (!localBrowserEnabled) {
    localBrowserDisabled("flo.browser.stopRequestCapture");
  }
  return normalizeBrowserValueResponse(
    await localBrowserRequest("/v1/commands", {
      command: { type: "stop_request_capture", capture_id: captureId },
      required_checks: Array.isArray(options?.required_checks) ? options.required_checks : [],
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

const loadVaultMocks = () => {
  if (loadedVaultMocks) {
    return cachedVaultMocks;
  }

  loadedVaultMocks = true;

  const file = process.env.FLO_MOCKS_FILE;
  if (!file) {
    cachedVaultMocks = { profile: {}, shared: {} };
    return cachedVaultMocks;
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

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("FLO_MOCKS_FILE must contain a JSON object");
  }

  const vault = (parsed as any).vault ?? {};
  if (!vault || typeof vault !== "object" || Array.isArray(vault)) {
    throw new Error("FLO_MOCKS_FILE `vault` must be an object when provided");
  }

  const profile = (vault as any).profile ?? {};
  const shared = (vault as any).shared ?? {};
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw new Error("FLO_MOCKS_FILE `vault.profile` must be an object when provided");
  }
  if (!shared || typeof shared !== "object" || Array.isArray(shared)) {
    throw new Error("FLO_MOCKS_FILE `vault.shared` must be an object when provided");
  }

  cachedVaultMocks = { profile, shared };
  return cachedVaultMocks;
};

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

globalThis.__flo_runtime = {
  sleep: async (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    }),
  time: {
    formatUnixTimestamp,
  },
  vault: {
    get: vaultGet,
  },
  state: {
    get: async () => unsupported("flo.state.get"),
    list: async () => unsupported("flo.state.list"),
    put: async () => unsupported("flo.state.put"),
    delete: async () => unsupported("flo.state.delete"),
  },
  task: {
    limits: {
      maxSpawnChildren: floTaskMaxSpawnChildren,
    },
    getToolState: async () => unsupported("flo.task.getToolState"),
    putToolState: async () => unsupported("flo.task.putToolState"),
    getContext: async () => taskContext(),
    emitEvent: async () => unsupported("flo.task.emitEvent"),
    spawnChildren: async () => unsupported("flo.task.spawnChildren"),
    waitForBatch: async () => unsupported("flo.task.waitForBatch"),
    getBatchResults: async () => unsupported("flo.task.getBatchResults"),
  },
  callTool: async () => unsupported("flo.callTool"),
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
export const time = runtime.time;
export const vault = runtime.vault;
export const state = runtime.state;
export const task = runtime.task;
export const callTool = runtime.callTool;
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
