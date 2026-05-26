# Manifest Basics

Flo discovers tools and skills by file name:

- `**/*.tool.yaml` defines one tool
- `**/*.skill.yaml` defines one skill
- `**/*.schedule.yaml` defines one bundle-managed schedule

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
  - this affects `/call` discoverability only; it does not automatically expose helper tools
- `script_tools`
  - defaults to `[]`
  - declares helper tool ids callable from this tool through `flo.callTool(...)`
  - these helpers are not automatically exposed to the LLM
  - these helpers are not listed by `/call` unless the helper tool also sets `direct_call: true`

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

Authoring rules:

- use `tools` when the model should be able to call the tool directly
- use `script_tools` when only your script should call the tool
- do not repeat an inline tool from `tool_definitions` in either `tools` or `script_tools`
- `script_tools` only changes LLM visibility; it does not create a separate security boundary from the selected skill's scripts

## Visibility Summary

Flo has separate visibility rules for normal execution and explicit `/call` usage.

During normal execution:

- the LLM sees globally available tools plus tools listed in the selected skills' `tools`
- the selected skills' scripts can call globally available tools plus tools listed in the selected skills' `tools` and `script_tools`
- inline tools from `tool_definitions` are available to the owning skill without being repeated elsewhere

During `/call` execution:

- `/call` lists tools whose manifests set `direct_call: true`
- the external-app direct-call API uses the same `direct_call: true` gate
- running `/call <tool_id>` preserves the current selected-skill context for nested tool access
- the called tool may always call itself
- the called tool may also call globally available tools and tools listed in that tool manifest's own `script_tools`
- helper tools still remain hidden unless they are global, reachable through the selected skill set, or declared in the direct-call tool's own `script_tools`

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
