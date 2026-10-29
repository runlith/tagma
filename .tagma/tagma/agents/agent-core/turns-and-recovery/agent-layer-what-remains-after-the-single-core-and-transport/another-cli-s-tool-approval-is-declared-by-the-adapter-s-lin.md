---
id: 01a151df-e920-73d7-9b09-09e3c2cb118a
title: Another CLI's tool approval is declared by the adapter's line, not the shared VENDOR_TOOLS table
ord: 18
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151fc-373c-7d50-af3f-30c4283c7c5b",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d091976ebe
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/asks/decision.ts
---
Another CLI's tool approval is declared by its adapter line, not a shared VENDOR_TOOLS table. In the original code `VENDOR_TOOLS` in `external-harnesses/asks/decision.ts` judged all CLIs by one table. The defect starts earlier: `claudeSubject` passes only Bash/Exec, Edit/MultiEdit, Write, and Read, reducing names to shared aliases; NotebookEdit and TodoWrite never reach the judge. Codex uses the same parse. ACP `judgedCall` replaces the name with a shared shape even when `name` stands. The fix belongs to the adapter declaration and the hook/ACP boundaries keeping the name; an unknown name stays an execution with review approval. A central table of others' parts contradicts [[edea5454]].

To do: the vendor line (`vendors/<vendor>/row.ts`) declares the shape and approval of Claude Code and Codex built-ins fully, by their true names; `decision.ts` reads that declaration. Hook keeps the original name, a known CLI picks its adapter before parsing; ACP reads the vendor `name` when the adapter declared such names. Other adapters receive the current table as a shared constant and the old ACP classification by `kind`. CLIs checked at setup: Claude Code 2.1.303, codex-cli 0.162.0. The Claude Code inventory is checked against the [official tools-reference](https://code.claude.com/docs/en/tools-reference) read 2026-10-19; Codex against `.external/codex` at `09bced5ad`, `core/src/tools/spec_plan.rs`, `handlers/*_spec.rs`, `hook_names.rs`, and `registry.rs`. The hook-name shape with namespace is set by `core/src/tools/mod.rs:flat_tool_name`: namespace and name join with no separator, and `spawn_agent` has a separate hook name. Connected MCP/extension tools form no finite built-in inventory and stay under the default for an unknown name.

Proof: 148 tests in 12 asks, adapter-table, protocol, and Claude Code runner files passed; the judge matrix checks every declared Claude Code and Codex name in trust/review/bypass. After vendor/kind refinement and `switch_mode` the protocol suite — 3 pass. Package `bun run typecheck` finished with exit 0 (5103 server files). Before the fix the public NotebookEdit path returned `null` instead of a call; now the original name reaches the judge. No live model CLI sessions started: built-ins and the hook shape confirmed by reading the named sources; dynamic and future unknown names stay under the conservative default.
