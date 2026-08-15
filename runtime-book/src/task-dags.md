# Durable Task DAGs And Named Steps

Use durable task DAGs for work that must survive agent restarts, wait on several prerequisites, or fan out beyond one script invocation.

## Spawn Typed Tasks

`flo.task.spawn(...)` is idempotent for the current parent task and `key`. It validates `input` immediately and validates the child's structured output before the child can succeed.

```ts
const research = await flo.task.spawn<{ topic: string }, { findings: string[] }>({
  key: "research",
  title: "Research the topic",
  objective: "Return concise, cited findings.",
  input: { topic: "durable execution" },
  input_schema: {
    type: "object",
    properties: { topic: { type: "string" } },
    required: ["topic"],
    additionalProperties: false,
  },
  output_schema: {
    type: "object",
    properties: { findings: { type: "array", items: { type: "string" } } },
    required: ["findings"],
    additionalProperties: false,
  },
});
```

Tasks may declare aliased `dependencies`, including tasks from another session owned by the same profile. The default join is `all` with `require_success`. `any` selects one deterministic winner. `all_settled` returns failed and cancelled results instead of failing the dependent task.

## Wait For Dependencies

```ts
const results = await flo.task.waitForDependencies({
  key: "research-ready",
  dependencies: [{ task_id: research.task_id, alias: "research" }],
});
```

If dependencies are pending, the current invocation ends. The promise from that invocation never resolves: after the dependencies resolve, Flo starts the script again at its entrypoint. On that new invocation the same keyed wait returns the frozen aliased results immediately.

This is the same stack-reentry behavior as `waitForBatch(...)`. Named steps make it easier to author code around that boundary.

## Memoize Sequential Work With Steps

```ts
const normalized = await flo.task.step(
  {
    key: "normalize",
    version: "1",
    input: results.research.output,
    output_schema: { type: "array", items: { type: "string" } },
    retry: {
      max_attempts: 3,
      initial_backoff_ms: 1_000,
      multiplier: 2,
      max_backoff_ms: 60_000,
    },
  },
  async ({ input, attempt, idempotency_key }) => {
    return normalizeFindings(input, { attempt, idempotency_key });
  },
);
```

Step identity is `(task_id, key, version)`. A completed step returns its stored output without running its callback. A dependency wait inside a step suspends the task; on entrypoint replay, earlier completed steps are skipped and the suspended step callback runs again with the same attempt and idempotency key.

Reusing an identity with different input, schemas, or retry configuration is an error. Increment `version` when callback behavior changes.

Only one step callback may be active in a task. Spawn tasks for durable parallel work instead of using `Promise.all` over `flo.task.step(...)` calls.

External side effects are not exactly-once across a crash between the effect and step persistence. Send the supplied `idempotency_key` to APIs that support idempotent requests.

## Cancellation

```ts
await flo.task.cancel({ task_id: research.task_id });
```

Cancellation follows ownership edges: it cancels the selected task and descendants it spawned. It never cancels shared prerequisite tasks.

The older `spawnChildren`, `waitForBatch`, and `getBatchResults` APIs remain supported.
