# floagent-skill-runtime

Generated runtime assets published from [`FlordaWeave/floagent`](https://github.com/FlordaWeave/floagent).

This repository is a release snapshot of the Flo skill-script runtime surface for local authoring, editor support, and lightweight Node-based testing. It is force-updated from tagged releases in the main Flo agent repository.

## Contents

- `flo.d.ts`: generated TypeScript declarations for `import * as flo from "flo:runtime"`
- `tsconfig.json`: minimal TypeScript config for skill-script authoring against the published runtime declarations
- `flo_hooks.mts`: local Node import hook for testing skill scripts with:

```bash
node --import=./flo_hooks.mts path/to/skill_script.mts
```

- `skills/builtin/`: built-in skill manifests shipped with the runtime
- `workers/playwright-worker/`: bundled Playwright worker source used by the local browser shim

## Intended Use

Use this repository when you want the current published runtime contract without cloning the full Flo agent monorepo.

Typical workflows:

1. Reference `flo.d.ts` in your editor or local TypeScript setup.
2. Use `tsconfig.json` as a minimal starting point for local TypeScript tooling around these runtime assets.
3. Use `flo_hooks.mts` to smoke-test script logic locally.
4. Inspect `skills/builtin/` to understand bundled built-in skills and manifests.

## `flo_hooks.mts` Notes

The Node shim is a developer aid, not a full `agentd` runtime replica.

- It registers the `flo:runtime` module for local Node imports.
- It supports a local-only async `__flo_main__()` export for ad hoc execution.
- It can mock `flo.vault.get(...)` with `FLO_MOCKS_FILE`.
- It can opt into local browser automation with `FLO_LOCAL_BROWSER=1`.
- Local browser mode starts the worker source from `workers/playwright-worker/src/server.js` and requires the `playwright` package for that worker.
- Runtime-bound APIs such as task orchestration and nested tool execution intentionally fail fast in the shim.

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
