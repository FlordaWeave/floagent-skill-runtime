# Dispatcher

Use `flo.dispatcher` when one scheduled task needs to coordinate durable work across many stable subjects such as warehouses, tenants, accounts, or pages.

The runtime owns leases, revisions, retries, and subject state persistence. Your script still owns:

- discovering subjects
- choosing stable `subject_key` values
- running the per-subject business logic
- deciding when to checkpoint
- optionally hinting the next due time on success or failure

## When To Use It

Use `flo.dispatcher` when:

- one task needs to process many independent partitions
- each partition needs its own cursor or progress state
- one subject failing should not block the others
- work may continue across retries or later schedule ticks

Use [Task State](task-tool-state.md) or [State](state.md) instead when you only need one shared checkpoint for the whole task.

## Dispatcher Identity

Dispatcher state is partitioned by:

- the current profile
- `dispatcher_id`
- `subject_key`

Scripts do not pass a task id or lease owner id. The runtime still requires normal execution context and derives lease ownership internally.

## Subject State Shape

Claim and mutation calls return server-issued subject state including:

- `subject_key`
- `status`
- `cursor`
- `meta`
- `next_due_at`
- lease fields
- attempt and failure counters
- `revision`

Treat `revision` as mandatory concurrency state. Every mutating call must send the latest revision returned by the runtime.

## Typical Flow

### 1. Sync discovered subjects

`syncSubjects(...)` creates missing subjects and refreshes bootstrap cursor, metadata, and due time for already-known non-active subjects.

```ts
import * as flo from "flo:runtime";

await flo.dispatcher.syncSubjects({
  dispatcher_id: "dispatcher.inventory",
  subjects: [
    {
      subject_key: "warehouse:cn-shenzhen",
      cursor: { page: 1 },
      meta: { warehouse_id: "cn-shenzhen" },
      next_due_at: new Date().toISOString(),
    },
  ],
});
```

V1 sync is additive only. Leaving a subject out of the payload does not delete it.
If a subject is already `leased` or `running`, sync does not overwrite its in-flight cursor or metadata.

### 2. Claim a bounded batch

```ts
const claim = await flo.dispatcher.claimDueSubjects<
  { page?: number; next_cursor?: string },
  { warehouse_id: string }
>({
  dispatcher_id: "dispatcher.inventory",
  limit: 10,
  lease_ms: 5 * 60 * 1000,
});
```

The runtime only claims:

- due unleased subjects
- subjects whose previous lease has expired

Each returned subject already includes the lease and current revision you need for later calls.

### 3. Checkpoint progress

Use `checkpointSubject(...)` for long-running subjects or paginated scans:

```ts
const running = await flo.dispatcher.checkpointSubject({
  dispatcher_id: claimed.dispatcher_id,
  subject_key: claimed.subject_key,
  revision: claimed.revision,
  cursor: { page: 2, next_cursor: "cursor-2" },
  meta: claimed.meta,
  lease_ms: 5 * 60 * 1000,
});
```

This persists progress, marks the subject `running`, and can extend the lease.

### 4. Complete, fail, or release

Complete with an explicit next due time:

```ts
await flo.dispatcher.completeSubject({
  dispatcher_id: running.dispatcher_id,
  subject_key: running.subject_key,
  revision: running.revision,
  cursor: running.cursor,
  meta: running.meta,
  next_due_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
});
```

Fail with a runtime retry hint:

```ts
await flo.dispatcher.failSubject({
  dispatcher_id: running.dispatcher_id,
  subject_key: running.subject_key,
  revision: running.revision,
  error: {
    code: "upstream_timeout",
    message: "warehouse API timed out",
  },
  retry_after_ms: 60_000,
});
```

Release without recording success or failure:

```ts
await flo.dispatcher.releaseSubject({
  dispatcher_id: running.dispatcher_id,
  subject_key: running.subject_key,
  revision: running.revision,
});
```

## Retry Behavior

`failSubject(...)` accepts either:

- `next_due_at`
- `retry_after_ms`

Do not send both. When you send neither, the backend applies its default retry schedule.

## Choosing Subject Keys

`subject_key` should be stable, deterministic, and specific to one logical partition:

- `warehouse:cn-shenzhen`
- `account:12345`
- `store:us-west:42`

Avoid keys that depend on timestamps, random ids, or transient pagination positions. Put changing progress into `cursor` instead.

## Practical Pattern

For schedule-driven fan-out work:

1. discover all current subjects
2. `syncSubjects(...)`
3. `claimDueSubjects(...)` with a small limit
4. process each claimed subject independently
5. checkpoint long work
6. complete or fail each subject individually

That pattern preserves per-subject isolation while keeping claim and retry correctness in the backend.

Subject state persists across later scheduled task runs for the same profile and dispatcher id, so cursors and retry history survive a fresh task UUID without leaking across different profiles.

For exact signatures, refer to [`flo.d.ts`](https://github.com/FlordaWeave/floagent/blob/main/flo.d.ts).
