# TypeScript Runtime

The public runtime surface comes from:

```ts
import * as flo from "flo:runtime";
```

The module exports these top-level helpers:

- `sleep`
- `getRuntimeConfig`
- `time`
- `vault`
- `state`
- `task`
- `dispatcher`
- `callTool`
- `browser`

## JSON-Oriented API Design

Runtime values are JSON-shaped. `FloJsonValue` includes:

- `null`
- `boolean`
- `number`
- `string`
- arrays of JSON values
- objects whose values are JSON values

This affects:

- tool inputs and outputs
- `flo.state`
- child-task input and output
- browser `evaluate` args and values

## Global Helpers

The runtime provides:

- `fetch(...)`
- `Blob`
- `File`
- `FormData`
- `URL`
- `URLSearchParams`

That means many integration-oriented tools can work without additional libraries.

For multipart uploads from the virtual workspace, create a VFS-backed `File` with `flo.file(...)`:

```ts
import * as flo from "flo:runtime";

const form = new FormData();
form.append("meta", JSON.stringify({ kind: "report" }));
form.append(
  "file",
  flo.file("task://artifacts/report.csv", {
    type: "text/csv",
    name: "report.csv",
  }),
);

await fetch("https://example.com/upload", {
  method: "POST",
  body: form,
});
```

## Task Context

Use `flo.task.getContext<T>()` to read durable task context:

```ts
type Context = {
  resume_payload?: {
    batch_id?: string;
  };
  custom?: { value: number };
};

const context = await flo.task.getContext<Context>();
```

The context may include resume data after a suspension flow. When a task resumes, the runtime re-enters the script from its entrypoint instead of restoring the JavaScript stack.

## Time and Sleep

Use `flo.sleep(ms)` to pause a script without blocking the runtime thread.

Use `flo.time.formatUnixTimestamp(...)` when you need stable date formatting:

```ts
const formatted = flo.time.formatUnixTimestamp(1_700_000_000, "YYYY-MM-DD HH:mm:ss", "UTC");
```

## Admin-Managed Runtime Config

Use `await flo.getRuntimeConfig(key)` to read one admin-managed plain-text runtime config value:

```ts
const apiBase = await flo.getRuntimeConfig("FLO_API_BASE");
```

This helper does not require a manifest entry, resolves to `undefined` when the key is not configured, and is intended for non-secret settings that admins manage centrally. Use `flo.vault.get(...)` for secrets.

## Local Shim Notes

The Node preload shim supports:

- `flo.sleep(...)`
- `flo.getRuntimeConfig(...)` with `FLO_MOCKS_FILE`
- `flo.time.formatUnixTimestamp(...)`
- `flo.vault.get(...)` with `FLO_MOCKS_FILE`
- `flo.state.*` with local state binding fixtures
- `flo.task.getContext(...)`
- `flo.task.emitEvent(...)`
- browser helpers when `FLO_LOCAL_BROWSER=1`

Other runtime-bound APIs, including `flo.dispatcher.*`, intentionally fail in the local shim so tests do not accidentally depend on unsupported local behavior.

Next: [Nested Tool Calls](nested-tool-calls.md)
