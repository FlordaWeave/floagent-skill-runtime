"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const unsupported = (name) => {
  throw new Error(
    `${name} is unavailable in the local Node flo shim. Run this script inside agentd or avoid calling this API in local tests.`,
  );
};

const formatUnixTimestamp = (timestamp, format, timezone) => {
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

  const replacements = {
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

let cachedVaultMocks;
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

  const profile = parsed.profile ?? {};
  const shared = parsed.shared ?? {};
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw new Error("FLO_MOCKS_FILE `profile` must be an object when provided");
  }
  if (!shared || typeof shared !== "object" || Array.isArray(shared)) {
    throw new Error("FLO_MOCKS_FILE `shared` must be an object when provided");
  }

  cachedVaultMocks = { profile, shared };
  return cachedVaultMocks;
};

const vaultGet = async (request) => {
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

globalThis.flo = {
  logger: {
    debug: (...args) => console.debug(...args),
    info: (...args) => console.info(...args),
    warn: (...args) => console.warn(...args),
    error: (...args) => console.error(...args),
  },
  sleep: async (ms) =>
    new Promise((resolve) => {
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
    emitEvent: async () => unsupported("flo.task.emitEvent"),
    spawnChildren: async () => unsupported("flo.task.spawnChildren"),
    awaitBatch: async () => unsupported("flo.task.awaitBatch"),
  },
  callTool: async () => unsupported("flo.callTool"),
  browser: {
    run: async () => unsupported("flo.browser.run"),
    startRequestCapture: async () => unsupported("flo.browser.startRequestCapture"),
    collectCapturedRequests: async () => unsupported("flo.browser.collectCapturedRequests"),
    stopRequestCapture: async () => unsupported("flo.browser.stopRequestCapture"),
    exportState: async () => unsupported("flo.browser.exportState"),
    importState: async () => unsupported("flo.browser.importState"),
  },
};

const targetPath = process.argv[1];
if (targetPath) {
  setImmediate(async () => {
    try {
      const moduleUrl = pathToFileURL(path.resolve(targetPath)).href;
      const loadedModule = await import(moduleUrl);
      if (!Object.prototype.hasOwnProperty.call(loadedModule, "__flo_main__")) {
        return;
      }

      const entrypoint = loadedModule.__flo_main__;
      if (typeof entrypoint !== "function") {
        throw new TypeError("Module export `__flo_main__` must be a function");
      }
      if (entrypoint.length !== 0) {
        throw new TypeError("Module export `__flo_main__` must not declare input parameters");
      }

      const result = await entrypoint();
      if (result !== undefined) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    }
  });
}
