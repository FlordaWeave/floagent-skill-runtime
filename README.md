# floagent-skill-runtime

Generated runtime assets published from [`FlordaWeave/floagent`](https://github.com/FlordaWeave/floagent).

This repository is a release snapshot of the Flo skill-script runtime surface for local authoring, editor support, and lightweight Node-based testing. It is force-updated from tagged releases in the main Flo agent repository.

## Contents

- `skills/flo.d.ts`: generated TypeScript declarations for `globalThis.flo`
- `flo_init.js`: local Node preload shim for testing skill scripts with:

```bash
node -r ./flo_init.js path/to/skill_script.ts
```

- `skills/builtin/`: built-in skill manifests shipped with the runtime

## Intended Use

Use this repository when you want the current published runtime contract without cloning the full Flo agent monorepo.

Typical workflows:

1. Reference `skills/flo.d.ts` in your editor or local TypeScript setup.
2. Use `flo_init.js` to smoke-test script logic locally.
3. Inspect `skills/builtin/` to understand bundled built-in skills and manifests.

## `flo_init.js` Notes

The Node shim is a developer aid, not a full `agentd` runtime replica.

- It installs `globalThis.flo`.
- It supports a local-only async `__flo_main__()` export for ad hoc execution.
- It can mock `flo.vault.get(...)` with `FLO_MOCKS_FILE`.
- Runtime-bound APIs such as browser automation, task orchestration, and nested tool execution intentionally fail fast in the shim.

Example `FLO_MOCKS_FILE`:

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

## Source Of Truth

The source of truth remains the main repository:

- Runtime implementation and docs: [`FlordaWeave/floagent`](https://github.com/FlordaWeave/floagent)
- Skill runtime documentation: [`docs/skills-runtime.md`](https://github.com/FlordaWeave/floagent/blob/main/docs/skills-runtime.md)

If you need to change the runtime API, update the main repository first. This snapshot is generated from releases and should not be edited manually.
