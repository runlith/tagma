---
id: 01a17f69-7cca-7d27-b6b0-831ef7fd2c9d
title: A fork learns its source from a `fork` world-state section in the first turn tail — not in the prompt and not in `<agent-birth>`
ord: 28
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a17f5d-9e25-780b-9302-7f0783cb4628
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/rows/native.ts
  - kind: symbol
    ref: apps/tagma/server/src/native-harness/turns/worldState.ts
    symbol: forkSection
---
A birth with a copied history — `branch_thread`, `spawn_agent` with `fork` or `forkFrom`, on any transport — records the source in `native_thread.fork_of`; the fork time is the thread record's own `created_at`, stored in no second copy. A `none` slice copies no history and counts as no fork.

The section stands in the turn's `<workspace>` context message, because only it reaches the first turn no matter who opened it: the operator's word, a spawn task, a continuation, another agent's message — on native through `RunAssembly`, on ACP through `open_hosted_turn`. A native fork keeping the source's agent, profile, project, provider, model and reasoning inherits its frozen profile and prompt, cache group, account, switches and team layer; copied messages are not rendered for the newborn. The branch makes that identity decision once, and birth hooks consume it rather than deciding inheritance again. Its inherited prefix remains eligible for the source cache, whose actual hit still depends on the provider's lifetime and availability. A requested identity change composes the new identity instead. A mark in the prompt or at the history start would invalidate the inherited prefix. There is no fork line in `<agent-birth>`: it reached only spawn and would duplicate the section.

Singularity is world state, not a separate flag. The delivered value is written in the same transaction as the context message, and the message remembers what it said. If it left history (rollback, withdrawn words), the section arrives again. After compaction it arrives together with the whole workspace, so the text says "history up to that point", not "everything above". A fork of a fork inherits the snapshot with its own source value, and the section speaks anew of the immediate source. A native run adopted after a restart or continued before the first step orients at start ([[58b1fb68]]), so the mark does not wait for the next turn with words.

Rolling back a late turn does not repeat the mark: the section is judged by the last standing message that told it. On ACP a fork's first turn that never reached the vendor leaves the opening as debt, and the mark leaves with the next opening ([[7d6de4a6]]).

Terminal CLIs receive no Tagma turn context, so they have no mark.
