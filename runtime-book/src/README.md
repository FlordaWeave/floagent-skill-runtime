# Flo Runtime Book

This book is the public guide for writing Flo skill manifests and script tools.

It covers the supported authoring surface exposed through:

- skill and tool manifests
- bundle-level runtime prompt manifests
- `flo.d.ts`
- `import * as flo from "flo:runtime"`
- the local Node preload shim in [`flo_hooks.mts`](https://github.com/FlordaWeave/floagent/blob/main/flo_hooks.mts)

Use this book when you are building or maintaining skills. Use the internal `docs/` directory only when you are working on Flo itself.

## What This Book Covers

- how to structure `*.tool.yaml` and `*.skill.yaml`
- how to structure bundle-level `*.prompts.yaml`
- how to write TypeScript or JavaScript tools
- how to call tools, store state, read vault secrets, emit debug events, and use browser automation
- how to orchestrate child tasks with `flo.task.spawnChildren(...)`

## What This Book Does Not Cover

- backend-service deployment
- message bus internals
- database schema
- transport topology
- internal control-plane behavior

Those topics are intentionally kept out of this book so the content stays focused on skill authors.
