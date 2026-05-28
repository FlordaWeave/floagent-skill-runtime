# Other APIs

This chapter collects the rest of the public author-facing runtime helpers.

## `flo.sleep(ms)`

Pause the script asynchronously:

```ts
await flo.sleep(500);
```

Use it sparingly for pacing, polling, or short waits between retries.

## `flo.time.formatUnixTimestamp(...)`

Format a Unix timestamp using the runtime helper:

```ts
const text = flo.time.formatUnixTimestamp(
  1_700_000_000,
  "YYYY-MM-DD HH:mm:ss",
  "UTC",
);
```

## `flo.task.getContext<T>()`

Read durable task context, including resume payloads:

```ts
const context = await flo.task.getContext<{
  resume_payload?: { batch_id?: string };
  custom?: { value: number };
}>();
```

## `flo.task.getProfile()`

Read the current runtime profile metadata for the tool caller:

```ts
const profile = await flo.task.getProfile();
const profileId = profile.profile_id;
const displayName = profile.display_name;
```

The returned object includes:

- `profile_id`
- `profile_kind`
- `permissions`
- optional `display_name`

In the local Node preload shim, `profile_id` defaults to `local-node-profile` and can be
overridden with `FLO_LOCAL_PROFILE_ID`. `display_name` can be set with
`FLO_LOCAL_PROFILE_DISPLAY_NAME`.

## `flo.task.limits`

Inspect runtime task-orchestration limits:

```ts
const maxChildren = flo.task.limits.maxSpawnChildren;
```

Use this value to chunk child-task work before calling `spawnChildren(...)`.

## `flo.task.getState(...)` And `flo.task.putState(...)`

Read and write lightweight task-scoped state shared by all tools in the current task:

```ts
await flo.task.putState({
  key: "checkpoint",
  value: { phase: "fetching" },
});

const checkpoint = await flo.task.getState<{ phase?: string }>({
  key: "checkpoint",
});
```

## Built-In Tools Through `flo.callTool(...)`

`flo.d.ts` includes typed support for built-ins such as:

- `read_text_file`
- `write_text_file`
- `read_dir`
- `zip`
- `unzip`
- `csv_*`
- `excel_*`
- `media_fetch`
- `media_push_vfs`
- `media_push_base64`
- `send_notification`
- `send_media_attachment`
- `activate_skill`
- `read_skill_resource`
- `import_skill_asset`

When a built-in already matches the file or media operation you need, prefer it over reimplementing the same behavior in script code.

## Skill Resources And Assets

Two built-ins are especially useful from authored skills:

- `activate_skill` proactively adds a visible skill to the current task by `skill_id`
  - activation is handled by suspending the current execution so `agentd` can restart the task turn with the expanded skill set
  - if the newly activated skills require labels the current agent does not satisfy, `agentd` may hand the task over before execution continues
- `read_skill_resource` reads a selected skill resource or imports it into VFS
- `import_skill_asset` copies a selected skill asset into VFS

Both are invoked through `flo.callTool(...)`.

## Final Notes

- Favor JSON-serializable inputs and outputs.
- Keep secrets in the vault, not in manifests or state.
- Use shared task state or task tool state for resume checkpoints, depending on whether later tools need the same checkpoint.
- Use the manifest as the contract for what your tool needs.

For exact TypeScript signatures, refer to [`flo.d.ts`](https://github.com/FlordaWeave/floagent/blob/main/flo.d.ts).
