# Nested Tool Calls

Use `flo.callTool(...)` to call another runtime tool from your script.

## Generic Form

```ts
const result = await flo.callTool({
  tool_id: "some_tool",
  input: { value: 1 },
});
```

The returned shape is:

- `status`
- `output`
- `error`

Possible statuses are:

- `success`
- `failed`
- `timeout`
- `validation_error`
- `suspended`

## Typed Built-In Calls

For built-in tools declared in `flo.d.ts`, TypeScript can infer the input and output shape:

```ts
const file = await flo.callTool({
  tool_id: "read_text_file",
  input: {
    path: "task://notes/summary.txt",
    max_bytes: 4096,
  },
});
```

## Error Handling Pattern

Always branch on `status` instead of assuming `output` exists:

```ts
const result = await flo.callTool({
  tool_id: "read_text_file",
  input: { path: "task://notes/summary.txt" },
});

if (result.status !== "success") {
  return {
    ok: false,
    status: result.status,
    error: result.error,
  };
}

return {
  ok: true,
  content: result.output?.content,
};
```

## Execution Context

Nested tool calls run in the same runtime tool execution context as the calling script. In practice, this means task- and session-scoped helpers continue to operate on the current task and current virtual workspace.

## Manifest Boundaries

`flo.callTool(...)` crosses a runtime tool boundary. The called tool runs with its own manifest-declared `vault` and `state` bindings, so the runtime applies that wiring automatically for the nested call.

By contrast, a plain TypeScript `import` does not create a new tool boundary. Imported code runs as part of the current script tool, so the current tool manifest must declare any `flo.vault.get(...)` and `flo.state.*` access used by that code.

Use `flo.callTool(...)` when you want another tool's manifest contract to apply. Use local imports when you just want to share code within one tool's existing manifest contract.

Good uses:

- reading or writing VFS files through built-in tools
- composing smaller tools into a larger workflow
- delegating format-specific work to a built-in tool

Avoid using nested calls as a substitute for simple local code when a direct script implementation is clearer.

Next: [Debug Events](debug-events.md)
