# Getting Started

Flo script tools run inside the Flo runtime and import their helpers from `flo:runtime`:

```ts
import * as flo from "flo:runtime";
```

The checked-in type declarations live in [`flo.d.ts`](https://github.com/FlordaWeave/floagent/blob/main/flo.d.ts). They are the source of truth for the public TypeScript surface documented in this book.

## Local Authoring Loop

1. Write or update a tool manifest such as `my_tool.tool.yaml`.
2. Write the script inline with `execution.script` or in a file with `execution.script_file`.
3. Use `flo.d.ts` for editor autocomplete and type checking.
4. Use the repo-root preload shim for local Node-based smoke tests:

```bash
node --import=./flo_hooks.mts path/to/script.mts
```

The preload shim can invoke an exported `__flo_main__()` for local testing. It is a development aid, not a full runtime replica.

For a full local testing workflow, see [Testing With Node.js](testing-with-nodejs.md).

## Runtime Constraints You Should Know Early

- Runtime script source can be JavaScript or TypeScript.
- TypeScript is transpiled at runtime, but it is not type checked there.
- Static relative imports are supported.
- Bare imports, package-style imports, and dynamic `import()` are rejected.
- Some APIs are still runtime-bound and intentionally fail in the local shim, including `flo.callTool(...)` and child-task orchestration. The shim does support `flo.state.*` when `FLO_MOCKS_FILE` includes matching `state_bindings`.
- Browser helpers require `FLO_LOCAL_BROWSER=1` in the local shim.

## Simple Script Example

```ts
import * as flo from "flo:runtime";

export async function run(input: { name?: string }) {
  await flo.task.emitEvent({
    event_type: "hello.started",
    title: "Greeting tool",
    message: "Preparing response",
    level: "info",
  });

  return {
    ok: true,
    greeting: `hello ${input.name ?? "world"}`,
  };
}
```

Next: [Testing With Node.js](testing-with-nodejs.md)
