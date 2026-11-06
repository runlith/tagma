---
id: 01a1b2fd-04a6-7d84-8709-6989a1488f2e
title: "A guide that withholds a reader input stands in its place: the step drops it and its stored event removes it from the history"
ord: 21
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1b2f1-6644-7b8c-ad1e-15cff2b5f5d1
sources:
  - kind: file
    ref: packages/agent/src/agent/turn/plan.ts
  - kind: file
    ref: packages/agent/src/thread/HistoryFold.ts
  - kind: symbol
    ref: packages/agent/src/thread/events.ts
    symbol: threadGuidanceEvent
  - kind: file
    ref: apps/tagma/server/src/native-harness/turns/pluginHooks.ts
---
A `beforeStep` rule that must keep a reader's message from the model answers a guide naming the message's reader input in `withholds`; the guide's text is what the model reads instead. Two places carry it, because the model's context has two sources: `planStep` drops the withheld inputs from the projected history and from the step's drained signals for every attempt of the step, and the guide's source carries `withholds` into the runtime-guidance frame, whose event gets a `withheld` facet that the history fold applies by removing every message with that reader input and appending the guide. Every later step and run projects the stored history, so the message never returns; the transcript keeps it, so the person still sees what they wrote.

Riding the guide rather than a separate event keeps the reason and the removal in one record written by the recorder's existing paths (step intent and flush) — a separate withhold event would need both paths taught a new kind and could land without its reason. Coalescing and the run's frame dedup key on `withholds` too, so two messages blocked with the same reason are both withheld. The removal is by reader-input id, not position, since signals and the opening message reach the history by their own events before the step that judges them.

The plugins' hook rule is the producer: a `beforeStep` block from any format — Tagma's `block`, `onFailure: 'block'`, a Claude Code or Codex `UserPromptSubmit` block — withholds the message it judged.
