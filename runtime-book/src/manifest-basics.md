# Manifest Basics

Flo discovers tools and skills by file name:

- `**/*.tool.yaml` defines one tool
- `**/*.skill.yaml` defines one skill
- `**/*.schedule.yaml` defines one bundle-managed schedule
- `**/*.prompts.yaml` defines one bundle-managed runtime prompt manifest

`SKILL.md` discovery is not supported.

## Tool Manifest Shape

Every tool manifest must include:

- `name`
- `description`
- `input_schema`
- `execution`

Optional fields include:

- `timeout_ms`
- `retry_policy`
- `vault`
- `state`
- `requires_permissions`
- `direct_call`
- `script_tools`

Example:

```yaml
name: capture_example
description: Open a page and return the current URL.
input_schema:
  type: object
  properties:
    url:
      type: string
  required: [url]
  additionalProperties: false
execution:
  type: script
  script_file: scripts/capture_example.mts
  entrypoint: run
timeout_ms: 30000
```

Tool field behavior:

- supported `agentd` slash commands are `/call` and `/web`

- `direct_call`
  - defaults to `false`
  - when `true`, the tool may be invoked explicitly through `/call <tool_id>`
  - it also makes the tool reachable from `flo.callTool(...)` even when the tool is outside the current selected-skill tool set
  - it does not automatically expose helper tools to the LLM
- `script_tools`
  - defaults to `[]`
  - declares helper tool ids callable from this tool through `flo.callTool(...)`
  - these helpers are not automatically exposed to the LLM
  - these helpers are not listed by `/call` unless the helper tool also sets `direct_call: true`
- `requires_permissions`
  - defaults to `[]`
  - declares permission ids required before the tool is usable
  - the caller must have all listed permissions

## Script Execution

For `execution.type = script`, define exactly one of:

- `script`: inline JavaScript or TypeScript
- `script_file`: a relative path under the manifest directory

Use `entrypoint` to select the exported function the runtime should call.

## Skill Manifest Shape

Every skill manifest must include:

- `skill_id`
- `name`
- `description`

Each skill must define exactly one instruction source:

- `instruction`
- `instruction_file`

Optional fields include:

- `version`
- `execution_model_tier`
- `tools`
- `script_tools`
- `tool_definitions`
- `requires_skills`
- `requires_labels`
- `requires_permissions`

Example:

```yaml
skill_id: browser_examples
name: Browser Examples
description: Browser-based tools for authenticated workflows.
execution_model_tier: large
tools:
  - read_text_file
script_tools:
  - send_media_attachment
tool_definitions:
  - name: capture_example
    description: Open a page and return the current URL.
    input_schema:
      type: object
      properties:
        url:
          type: string
      required: [url]
    execution:
      type: script
      script_file: scripts/capture_example.mts
      entrypoint: run
instruction_file: instructions.md
```

Field behavior:

- `tools`
  - declares referenced external or built-in tool ids for the selected skill
  - these tools are exposed to the LLM tool list
  - these tools are also callable from `flo.callTool(...)`
- `execution_model_tier`
  - optionally requests the execution-stage model tier for that skill
  - allowed values: `nano`, `small`, `medium`, `large`, `frontier`
  - applies only to the main execution stage, not task selection, gate, or task summary
  - when multiple selected skills request different tiers, Flo uses the highest requested tier
  - the requested tier is resolved through the runtime's configured tier-to-model mapping
  - when omitted, Flo uses the configured execution-stage model
- `script_tools`
  - declares referenced external or built-in tool ids for the selected skill
  - these tools are callable from `flo.callTool(...)`
  - these tools are not exposed to the LLM tool list
- `tool_definitions`
  - declares inline tool manifests owned by the skill
  - inline tools are available to the selected skill without being repeated in `tools` or `script_tools`
- `requires_permissions`
  - defaults to `[]`
  - declares permission ids required before the skill is visible or selectable
  - the caller must have all listed permissions

Authoring rules:

- use `tools` when the model should be able to call the tool directly
- use `script_tools` when only your script should call the tool
- do not repeat an inline tool from `tool_definitions` in either `tools` or `script_tools`
- `script_tools` only changes LLM visibility; it does not create a separate security boundary from the selected skill's scripts

## Visibility Summary

Flo has separate visibility rules for normal execution and explicit `/call` usage.

During normal execution:

- the LLM sees globally available tools plus tools listed in the selected skills' `tools`
- the selected skills' scripts can call globally available tools, tools listed in the selected skills' `tools` and `script_tools`, and any tool whose manifest sets `direct_call: true`
- inline tools from `tool_definitions` are available to the owning skill without being repeated elsewhere

During `/call` execution:

- `/call` lists tools whose manifests set `direct_call: true`
- the external-app direct-call API uses the same `direct_call: true` gate
- running `/call <tool_id>` preserves the current selected-skill context for nested tool access
- the called tool may always call itself
- the called tool may also call globally available tools and tools listed in that tool manifest's own `script_tools`
- helper tools still remain hidden unless they are global, reachable through the selected skill set, or declared in the direct-call tool's own `script_tools`

## Permission Catalogs

Permissions are bundle-scoped. A skill bundle may include at most one `*.permissions.yaml` file.

Use the catalog file to define the permission ids that skills and tools reference from `requires_permissions`.

Example:

```yaml
catalog_id: admin
version: v1
groups:
  - group_id: admin
    name: Admin
    description: Administrative actions
    permissions:
      - permission_id: admin.roles.write
        name: Manage roles
        description: Create, update, and delete roles
      - permission_id: admin.permissions.read
        name: View permission catalog
```

Catalog fields:

- `catalog_id`
  - optional stable identifier for the catalog
- `version`
  - optional catalog version string
- `groups`
  - required list of permission groups
- `groups[].group_id`
  - required unique group id
- `groups[].name`
  - required display name
- `groups[].description`
  - optional description
- `groups[].permissions`
  - list of permissions in the group
- `groups[].permissions[].permission_id`
  - required unique permission id used by `requires_permissions`
- `groups[].permissions[].name`
  - required display name
- `groups[].permissions[].description`
  - optional description

Authoring rules:

- define each permission id once in the bundle catalog
- use exact permission ids in `requires_permissions`
- permission ids, group ids, and names must be non-empty
- leading or trailing whitespace is rejected
- duplicate `group_id`, `permission_id`, or `requires_permissions` entries are rejected
- if a bundle includes more than one `*.permissions.yaml` file, loading fails

Runtime behavior:

- a skill with `requires_permissions` is hidden unless the caller has all listed permissions
- a tool with `requires_permissions` is unavailable unless the caller has all listed permissions
- profile permission assignment is validated against the active bundle slot's catalog
- if a profile is granted a permission id that is not defined in the active catalog, the update is rejected

## Runtime Prompt Manifest Shape

Runtime prompt manifests are bundle-scoped resources. They are not owned by a skill.

Flo loads at most one `*.prompts.yaml` file from a bundle. If more than one is present, bundle loading fails.

Required fields:

- `execution.preamble`

Example:

```yaml
execution:
  preamble: |
    You are a slot-scoped runtime.
    Keep responses concrete and concise.
```

Field behavior:

- `execution.preamble`
  - required non-empty string
  - prepended to the runtime's configured execution-stage prompt
  - if the runtime execution prompt is empty, the preamble is used by itself

Authoring rules:

- use this manifest for bundle-wide execution guidance that should apply regardless of which skills are selected
- keep it focused on durable execution behavior, not one-off task content
- unknown top-level fields are rejected
- the current manifest shape is intentionally narrow; today only `execution.preamble` is supported

## Schedule Manifest Shape

Schedule manifests are bundle-scoped resources. They are not owned by a skill.

Required fields:

- `schedule_id`
- `profile_channel`
- `profile_external_user_id`
- `user_message`
- exactly one of `trigger` or `cron_expression`
- `timezone`

Optional fields:

- `context`
- `target_agent_override`
- `required_labels`
- `selected_skill_ids`
- `skip_skill_selection`
- `enabled`
- `cron_expression`

Example:

```yaml
schedule_id: morning_digest
profile_channel: wecom
profile_external_user_id: alice
user_message: Send the morning digest.
selected_skill_ids:
  - skill.digest
trigger:
  kind: recurring
  times_of_day:
    - hour: 9
      minute: 0
timezone: America/Toronto
enabled: true
```

Behavior:

- Flo reconciles schedule manifests when a skill bundle is pushed and when `backend-service` starts with persisted bundle slots.
- Flo resolves `profile_channel` plus `profile_external_user_id` through the runtime alias table.
- If the alias does not exist, Flo auto-creates a normal non-admin user profile and records the alias.
- If a schedule manifest is removed, Flo deletes the managed schedule but does not delete the profile or alias it created.
- Managed schedules are read-only in the admin UI except for `Run now`.

## Schedule Trigger Shape

When using `trigger`, the supported shape is:

```yaml
trigger:
  kind: recurring
```

Recurring triggers support these fields:

- `minutes_interval`
  - optional integer in `1..=59`
  - runs every N minutes
- `hours_interval`
  - optional integer in `1..=23`
  - runs every N hours
- `times_of_day`
  - optional list of wall-clock times
  - each item has `hour` in `0..=23` and `minute` in `0..=59`
- `days_of_week`
  - optional list of weekdays using `0..=6`
  - `0` is Sunday, `6` is Saturday

Validation rules:

- define exactly one of `minutes_interval`, `hours_interval`, or `times_of_day`
- `days_of_week` is a filter and may be combined with any one of the cadence options above
- `times_of_day` entries must not contain duplicates
- in v1, all `times_of_day` entries must share the same `minute`
- `days_of_week` must not contain duplicates

Examples:

Every 15 minutes:

```yaml
trigger:
  kind: recurring
  minutes_interval: 15
```

Every 6 hours:

```yaml
trigger:
  kind: recurring
  hours_interval: 6
```

At 09:00 and 17:00 every weekday:

```yaml
trigger:
  kind: recurring
  times_of_day:
    - hour: 9
      minute: 0
    - hour: 17
      minute: 0
  days_of_week: [1, 2, 3, 4, 5]
```

Use `cron_expression` instead of `trigger` when you need a schedule shape that is not covered by the recurring trigger fields.

## State and Vault Declarations

Use `state` when your script needs durable non-secret data:

```yaml
state:
  - name: session_counter
    key_prefix: counter.session.
    scope_kind: session
  - name: shared_counter
    key_prefix: counter.shared.
    scope_kind: shared
    scope_id: service
```

Use `vault` when your script needs secrets:

```yaml
vault:
  - key: api_token
    scope_kinds: [profile, shared]
```

The runtime still requires the script to fetch secrets explicitly through `flo.vault.get(...)`.

## Import Rules

The script runtime supports:

- local static ESM imports
- relative `.mjs`, `.mts`, and related local module paths

The runtime rejects:

- bare specifiers
- package-style imports
- dynamic `import()`
- `..` traversal for author-facing asset imports

Next: [TypeScript Runtime](typescript-runtime.md)
