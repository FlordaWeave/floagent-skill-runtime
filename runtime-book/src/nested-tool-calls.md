# Nested Tool Calls

Use `flo.callTool(...)` to call another runtime tool from your script.

The supported `agentd` slash commands are `/call` and `/web`.

Nested calls are still scoped by the selected skill set. A script can call:

- globally available runtime tools
- tools listed in the skill manifest's `tools`
- tools listed in the skill manifest's `script_tools`
- inline tools declared via `tool_definitions`

When a tool is invoked through `/call`, nested calls are scoped differently. A direct-call tool can call:

- globally available runtime tools
- tools reachable through the current selected skill set
- the direct-call tool itself
- tools listed in that tool manifest's `script_tools`

`script_tools` are the usual choice when you want a helper tool callable from script without adding it to the LLM-visible tool list. Inline tools from `tool_definitions` are also callable because they are compiled into the selected skill's runtime tool set automatically.

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

When `error` is present, it includes:

- `retryable`: whether the failed task/run is eligible for retry
- `continuable`: whether the model may continue the current turn after that failed call

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

## Manifest Setup

Use `tools` when the LLM should be able to call the tool directly.

Use `script_tools` when only your script should call it:

```yaml
skill_id: file_sender
name: File Sender
description: Prepare a file and return it as an attachment.
script_tools:
  - send_media_attachment
instruction_file: instructions.md
```

In that example, `send_media_attachment` is available to `flo.callTool(...)` inside the selected skill's scripts, but it is not exposed in the execution-stage LLM tool list.

For `/call`, declare helper access on the tool itself:

```yaml
name: publish_report
description: Publish a prepared report.
direct_call: true
script_tools:
  - send_media_attachment
input_schema:
  type: object
  additionalProperties: false
execution:
  type: script
  script_file: scripts/publish_report.mts
  entrypoint: run
```

That makes `publish_report` callable from `/call publish_report`, while `send_media_attachment` stays nested-only unless it separately declares `direct_call: true`. The same `direct_call: true` eligibility also governs typed direct-call invocations from external apps.

## Direct-Call Visibility Rules

`direct_call: true` answers one question only: whether a tool can be invoked explicitly through `/call` or through the external-app direct-call API.

It does not:

- add the tool to the normal execution-stage LLM tool list
- expose that tool's helpers to the LLM
- make every other selected-skill-only helper automatically callable

In practice:

- `tools` controls what the execution-stage LLM can call for a selected skill
- `script_tools` controls helper access from `flo.callTool(...)` without exposing those helpers to the LLM
- `direct_call: true` controls whether `/call <tool_id>` is allowed
- a helper used from a direct-call tool still needs to be global, available through the current selected skills, or declared in the direct-call tool's own `script_tools`

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
- calling skill-scoped helper tools through `script_tools` without polluting the prompt tool list
- delegating format-specific work to a built-in tool

Avoid using nested calls as a substitute for simple local code when a direct script implementation is clearer.

Next: [Debug Events](debug-events.md)
