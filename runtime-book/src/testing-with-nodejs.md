# Testing With Node.js

Use the repo-root [`flo_hooks.mts`](https://github.com/FlordaWeave/floagent/blob/main/flo_hooks.mts) preload shim to smoke-test script tools locally with Node.js.

This is the fastest way to validate script logic before running inside the full Flo runtime.

## What The Preload Shim Does

`flo_hooks.mts` registers the `flo:runtime` module for local Node execution and provides a partial implementation of the public runtime surface.

It is useful for:

- module loading and import resolution
- `flo.d.ts`-backed local TypeScript authoring
- `flo.sleep(...)`
- `flo.time.formatUnixTimestamp(...)`
- `flo.vault.get(...)` with mock data
- `flo.state.*` with local binding fixtures
- `flo.task.getToolState(...)`
- `flo.task.putToolState(...)`
- `flo.task.getContext(...)`
- `flo.task.emitEvent(...)`
- browser smoke tests when `FLO_LOCAL_BROWSER=1`

It is not a full runtime replica.

## Basic Invocation

Run a script file directly through Node:

```bash
node --import=./flo_hooks.mts path/to/skill_script.mts
```

If the module only exports `run(...)`, nothing is auto-invoked. For local ad hoc testing, export `__flo_main__()`:

```ts
import * as flo from "flo:runtime";

export async function __flo_main__() {
  await flo.task.emitEvent({
    event_type: "local.test",
    title: "Node smoke test",
    message: "Running locally through flo_hooks.mts",
    level: "info",
  });

  return {
    ok: true,
    now: flo.time.formatUnixTimestamp(1_700_000_000, "YYYY-MM-DD HH:mm:ss", "UTC"),
  };
}
```

When `__flo_main__()` returns a value, the preload shim prints it as JSON.

## Typical Local Test Layout

1. Keep the real runtime entrypoint as `export async function run(input)`.
2. Add a temporary or test-only `__flo_main__()` that calls `run(...)` with local fixture input.
3. Execute the script with `node --import=./flo_hooks.mts ...`.
4. Remove or keep `__flo_main__()` only if it remains useful for manual testing.

Example:

```ts
import * as flo from "flo:runtime";

export async function run(input: { name?: string }) {
  return {
    greeting: `hello ${input.name ?? "world"}`,
  };
}

export async function __flo_main__() {
  return run({ name: "local-dev" });
}
```

## Mocking Task Context

Use `FLO_TASK_CONTEXT_JSON` to provide a local durable task context:

```bash
FLO_TASK_CONTEXT_JSON='{"resume_payload":{"batch_id":"batch-1"},"custom":{"value":42}}' \
node --import=./flo_hooks.mts ./script.mts
```

Then read it in the script:

```ts
const context = await flo.task.getContext<{
  resume_payload?: { batch_id?: string };
  custom?: { value: number };
}>();
```

This is useful for testing resume-aware logic.

## Mocking Vault Secrets

Use `FLO_MOCKS_FILE` to provide mock vault values:

```json
{
  "vault": {
    "profile": {
      "demo-token": "secret-value"
    },
    "shared": {
      "shared-scope": {
        "api-token": "shared-secret"
      }
    }
  }
}
```

Run with:

```bash
FLO_MOCKS_FILE=./vault_mocks.json \
node --import=./flo_hooks.mts ./script.mts
```

Then fetch values normally:

```ts
const profileSecret = await flo.vault.get({
  scope: "profile",
  key: "demo-token",
});

const sharedSecret = await flo.vault.get({
  scope: "shared",
  scope_id: "shared-scope",
  key: "api-token",
});
```

## Browser Testing

Browser helpers stay disabled unless `FLO_LOCAL_BROWSER=1` is set.

Basic browser-mode invocation:

```bash
FLO_LOCAL_BROWSER=1 \
node --import=./flo_hooks.mts ./script.mts
```

The shim can also point at a custom local worker module:

```bash
FLO_LOCAL_BROWSER=1 \
FLO_LOCAL_BROWSER_WORKER_MODULE=./tests/fixtures/flo-init/fake_playwright_worker.mjs \
node --import=./flo_hooks.mts ./script.mts
```

Use browser mode for smoke tests around:

- navigation
- screenshots
- request capture
- storage state import and export

## Mocking State Bindings

Use `FLO_MOCKS_FILE` to provide local state binding metadata and stored values:

```json
{
  "state_bindings": [
    {
      "name": "profile_cache",
      "key_prefix": "cache.",
      "scope_kind": "profile"
    },
    {
      "name": "shared_cache",
      "key_prefix": "cache.shared.",
      "scope_kind": "shared",
      "scope_id": "service"
    }
  ],
  "state": {
    "profile": {},
    "session": {},
    "task": {},
    "shared": {}
  }
}
```

Then call the runtime with `scope_kind`:

```ts
await flo.state.put({
  scope_kind: "profile",
  key: "cache.answer",
  value: { answer: 42 },
});

await flo.state.get({
  scope_kind: "shared",
  key: "cache.shared.answer",
});
```

Shared local bindings must declare `scope_id` in `state_bindings`; the shim does not accept request-time `scope_id` for `flo.state.*`.

## What Fails Fast In The Local Shim

Some runtime-bound APIs intentionally throw instead of pretending to work:

- `flo.callTool(...)`
- `flo.task.spawnChildren(...)`
- `flo.task.waitForBatch(...)`
- `flo.task.getBatchResults(...)`

## Recommended Workflow

- Use the Node preload shim for fast iteration on parsing, transforms, formatting, control flow, vault mocks, and state flows.
- Use `FLO_TASK_CONTEXT_JSON` to exercise resume-aware logic.
- Use `FLO_LOCAL_BROWSER=1` only for browser-specific smoke tests.
- Use runtime or integration tests for nested tool calls and child-task orchestration.

Next: [Manifest Basics](manifest-basics.md)
