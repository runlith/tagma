---
id: 01a18d50-f344-7857-a8b2-e3225a3bed29
title: Resolve standing architecture findings and reduce recorded module coupling
ord: 27
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a18d3d-abce-7ac0-a4c4-0ae425400674
---
Remove the repeated declarations, unused production exports and direct model-call violations recorded by the architecture checks, at their real owners. Before working on an area, find the full cause and take over the debt of every file it covers. Reduce recorded module coupling without raising its ceilings; vendor identifiers remain owned by the adapter-packaging spec.

These same-module copies were read at `6ea852a4ec` and remain work, not inspection debt: the shared-type inspection does not judge same-module shapes.

- `SettingSection` / `SettingText`: `apps/tagma/app/src/lib/features/settings/SettingsCatalog.svelte.ts:14`, `apps/tagma/app/src/lib/features/settings/match.ts:3`.
- `SurfaceRefusal` / `Refusal`: `apps/tagma/desktop/src/bridge.ts:121`, `apps/tagma/desktop/src/server.ts:30`.
- `FileSide` / `LaidSide`: `apps/tagma/inspection/src/core/program.ts:46`, `apps/tagma/inspection/src/runners/oxlint/adapter.ts:20`.
- Inspection syntax `Node`: `apps/tagma/inspection/src/packs/effect/call-services/implementation.ts:14`, `apps/tagma/inspection/src/packs/effect/swallowed-failures/syntax.ts:1`.
- Code-facts syntax `Node`: `packages/code-facts/src/languages/js/declarations.ts:6`, `packages/code-facts/src/languages/js/usage.ts:5`.
- `Walk` / `PageWalk`: `apps/tagma/server/src/browser/contract/service/pages.ts:31`, `apps/tagma/server/src/browser/store/ledger.ts:16`.
- `Listed` / `Rows`: `apps/tagma/server/src/enforcement/engineVoice.ts:75`, `apps/tagma/server/src/enforcement/rules/engineReading.ts:47`.
- `FarStep` / `OutgoingRow`: `apps/tagma/server/src/graph/contract/service/foreign.ts:42`, `apps/tagma/server/src/graph/serving/copyIndex.ts:49`.
- `Rewritten` / `GraphProjection`: `apps/tagma/server/src/graph/operations/projects.ts:29`, `apps/tagma/server/src/graph/tree/projection.ts:146`.
- `StandingKey` / `KeptKey`: `apps/tagma/server/src/providers/credentials/consoleKeys.ts:15`, `apps/tagma/server/src/providers/credentials/consoleKeyFile.ts:39`.
- `ThreadStreamToolCall` / `AskedToolCall` / `UserQuestionToolCall`: `packages/agent/src/thread/run/ThreadStreamSink.ts:15`, `packages/agent/src/thread/run/ToolQuestion.ts:21`, `packages/agent/src/tools/UserQuestion.ts:44`.
- `RouteBody` / `ProtocolBody`: `packages/llm/src/llm/route/definition.ts:36`, `packages/llm/src/llm/route/protocol.ts:16`.
