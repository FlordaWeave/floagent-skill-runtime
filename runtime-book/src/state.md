# State

Use `flo.state` for durable non-secret data declared in the tool manifest.

## Declaring State Bindings

Declare named bindings in the manifest:

```yaml
state:
  - name: session_counter
    key_prefix: counter.session.
    scope_kind: session
  - name: task_audit
    key_prefix: counter.audit.
    scope_kind: task
  - name: shared_carrier_map
    key_prefix: carrier_mapping/
    scope_kind: shared
    scope_id: service
```

## Supported Scope Kinds

Manifest state bindings support these scope kinds:

- `profile`
- `session`
- `task`
- `shared`

For `shared`, bindings must declare `scope_id`. Scripts do not pass `scope_id` at runtime.

## Read, List, Write, Delete

Read one key:

```ts
const entry = await flo.state.get<{ total: number }>({
  scope_kind: "session",
  key: "counter.session.total",
});
```

List a prefix:

```ts
const page = await flo.state.list({
  scope_kind: "task",
  key_prefix: "counter.audit.events.",
  limit: 100,
});
```

Write with optional TTL and optimistic concurrency:

```ts
const write = await flo.state.put({
  scope_kind: "session",
  key: "counter.session.total",
  value: { total: 4 },
  ttl_seconds: 3600,
  if_revision: entry?.revision ?? null,
});
```

Delete:

```ts
const deleted = await flo.state.delete({
  scope_kind: "session",
  key: "counter.session.total",
  if_revision: entry?.revision ?? null,
});
```

## Result Shapes

State entries include:

- `key`
- `value`
- `revision`
- optional `expires_at`

Writes return:

- `ok`
- optional `entry`
- optional `conflict_revision`

## When To Use `flo.state`

Use manifest-declared state for:

- caches that need clear ownership
- profile/session/task/shared durable data
- multi-step flows that need explicit persistence

The runtime authorizes each call by matching the request `scope_kind` and key or key prefix against the manifest-declared bindings for the tool.

Use [Task Tool State](task-tool-state.md) for lightweight task-scoped convenience state that does not need a manifest binding.

## Shared Scope Pattern

Prefer multiple explicit shared bindings over a single dynamic shared namespace:

```yaml
state:
  - name: service_cache
    key_prefix: cache.service.
    scope_kind: shared
    scope_id: service
  - name: billing_cache
    key_prefix: cache.billing.
    scope_kind: shared
    scope_id: billing
```

Then scripts stay explicit about the backing storage kind:

```ts
await flo.state.get({
  scope_kind: "shared",
  key: "cache.service.answer",
});
```

Next: [Task Tool State](task-tool-state.md)
