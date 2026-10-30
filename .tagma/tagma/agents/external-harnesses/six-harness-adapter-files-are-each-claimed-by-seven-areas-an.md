---
id: 01a0cb2d-7d5b-7935-b5a4-e3cac9154a67
title: Six harness adapter files are each claimed by seven areas, and no graph-only move clears it — the table's layout is the decision
ord: 155
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0ca97-13e3-7639-9dcc-eea8f2781507
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/vendors/claude-code/row.ts
  - kind: file
    ref: packages/adapter-google/src/harness/gemini.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/contract/wire/sources.ts
    symbol: FILE_KINDS
---
`owner-spread` (threshold five, `apps/tagma/server/src/protocol/numbers.ts:31`) stands on `apps/tagma/server/src/protocol/harness/{gemini,grok,claude,codex,cursor,devin}.ts`: seven areas each hold a verified invariant over the same one-CLI-per-file table — [[62c4c0fc]], [[79d2a545]], [[b318fc25]], [[4a45ae5b]], [[84e4f537]], [[b8d7f55c]], [[b981c47a]]. A graph-only remedy is impossible: `FILE_KINDS = ['file', 'symbol', 'check']` (`apps/tagma/server/src/protocol/sources.ts:21`) counts a symbol source as claiming its file too, so narrowing an anchor cannot lower the count, and the claims that quantify over the rows — each CLI's model reading, the rows whose widgets were measured, the one row that prepares its vendor root — cannot drop a source without leaving a totality uncheckable. Three genuinely misplaced file sources were re-anchored at their owner and verified; the rest is layout. Done when the decision is taken: split an adapter so one concern's declarations leave the file — knowing that a split which does not separate the fields the cross-row claims measure only moves the spread — or the layout is accepted as it stands.