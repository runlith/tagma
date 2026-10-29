---
id: 01a15efe-dde8-779e-8a8d-ec0a38b81b77
title: "An operation's voice and feed projections are given by its owners: first its body's own, then the module's presentation, then the shared voice"
ord: 10
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a15eb1-1b10-757c-ac79-89ebc8d8b62b
sources:
  - kind: symbol
    ref: apps/tagma/server/src/invocation/presentation.ts
    symbol: presentationOf
  - kind: symbol
    ref: apps/tagma/server/src/platform/contract/service/manifest.ts
    symbol: presentationsOf
  - kind: symbol
    ref: apps/tagma/server/src/platform/contract/wire/manifest.ts
    symbol: journaledOf
---
`invocation` knows neither modules nor their answers, so the operation's voice and feed projections are assembled from what the owners declared: the body's own `voice`/`display`, then its module's presentation (`presentation` in the server manifest), then the shared voice by the answer's schema. A module's presentation names the operations it draws; unnamed — all the module's operations. Composition refuses when a module presents an operation it does not declare — otherwise the module would again draw others' answers, like the old `graph`/`thread` "families".

A module's voice answers `UNVOICED` for an answer it does not draw better than the shared one, not a JSON string. A refusal (`status: refused`) reaches neither voice nor the module's projection: the door's voice is `refusalLines` (`@runlith/agent/tool/refusal`), and display is the `none` shape with the calling projection's heading, the same subject as the running call. Display has no bodies of a refusal: the feed shows the cause from `toolRefusal` once, and text for the agent — in the call's details; a `text` body with the same lines would repeat the cause as a second view.

The answer's display is assembled by one `answerDisplay` function over `presentationOf`, called by every door: native puts it into `ToolAnswer`, HTTP — into the answer's `_meta.toolDisplay`, after the `answer` projection and the call's journal write, so the graph record's `opens` reaches MCP and `tagma op` too. Each door's own assembly would repeat this order only in part: HTTP, taking only the body's `display`, lost module projections (graph, threads, change-record, landing, mcp, performance).

An operation's belonging to the graph's journal (`journaled` in the module's manifest) is a separate fact, unrelated to voice: only modules whose acts write journal events with the call's key declare it — graph (except `touch_path`, `rewrite_graph_files`, `resolve_graph_conflict` — and reflections). Only they get `settleJournalCall` substituted by composition; an operation with no own `settle` gets `unknown` after a restart, not "did not happen". The app chooses its feed lines by the owner module (`operationsOwnedBy`), not by this belonging.
