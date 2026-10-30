---
id: 01a16437-4c54-7470-ac60-eaf74ff4c780
title: "Cursor SDK 1.0.35: Bun bundle and local-adapter bounds with no working API key"
ord: 13
tags: ["research"]
fields:
  {
    "source": {
      "name": "@cursor/sdk 1.0.35 local under Bun 1.4.3",
      "ref": "Local probe of 2026-10-22; bundled code and .d.ts of npm @cursor/sdk@1.0.35; no working API key obtained, model never called"
    }
  }
---
No working API key was obtained; the model was never called. Only the import and the authentication refusal are measured; the rest is a reading of the published types and the bundled 1.0.35 code. Probes are kept in `~/.tagma-dev/scratch/01a163f8-406e-7cbc-9ccd-cb12ce9cd55b/`: `external/absolute.ts`, `probe.ts`, `mcp.ts`, `source-evidence.ts`; exact SDK fragments and their byte offsets — `source-evidence.json`.

**Bun.** Under Bun 1.4.3 an absolute import of the flat entry from another folder took 142–151 ms, process RSS after import 68.6–68.9 MB. `bun build --target bun` produced a self-contained bundle; after deleting the project's own `node_modules` its import took 52.5–59.5 ms, RSS 61.5–61.8 MB. This is no local-run startup measurement: `Agent.create` with a deliberately invalid key failed with `AuthenticationError: Invalid User API Key`. In `dist/bundled/index.js` the function `pd0` looks for the platform package by ancestors of `process.argv[1]`, then `process.execPath`, not by the importing SDK's location; `GL6` admits a system `rg`, `HL6` refuses when a requested but unavailable sandbox is asked for.

**Adapter contract by code.** `agent/options.d.ts` declares `tools: ['mcp']` as a restriction of the main loop to the whole MCP family; `task` separately permits subagents. `X58` removes `customTools` descriptors once per run; a per-send set replaces the agent-level set. `K58` passes the callback `toolCallId` and `sessionId`, with no abort signal, and directly awaits its Promise; `HJ8` sets an approving provider for custom tools. The public interface has no programmatic update of their catalog mid-run. `qN6`/`BN6` serialize images and `isError`. Normalizer `lU6` emits `assistant` only for text deltas, and calls separately as `tool_call`; `f51` also passes `tool-requests-listed {callCount}`, `step-started`, `step-completed` into `onDelta`. The order of this barrier relative to `execute` is undetermined without a live turn.

**Environment.** `$_0` turns both `settingSources: undefined` and `[]` into an empty set alike. `m$8` enables file MCP, hooks, and extensibility strictly by sources — for `['project']` the project ones, without user level. `rF6` creates Statsig with `disableStorage: true`. But `kM0` writes transcripts regardless of `local.store`: `J88`/`BM0` pick `${CURSOR_DATA_DIR || '~/.cursor'}/projects/<workspace>/…`. Real records of a successful run, the server gate for `systemPrompt`, parallelism, cancel, long callbacks, and MCP `list_changed` handling are unverified. Official note on the flat bundle: https://cursor.com/docs/sdk/typescript#single-file-bundles-and-compiled-executables.
