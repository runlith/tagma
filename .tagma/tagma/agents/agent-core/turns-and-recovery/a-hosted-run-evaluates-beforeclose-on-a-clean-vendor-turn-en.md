---
id: 01a1a98b-2f2b-7ff2-bda7-2af2cf51d2a8
title: A hosted run evaluates beforeClose on a clean vendor turn end and continues the same run when a rule guides
ord: 28
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a1a889-5a08-79a0-96d3-585a6ed28265
  - kind: relates
    to: 01a10990-19df-7b97-abc8-1c7f8e0f35a1
  - kind: relates
    to: 01a15261-6006-77e2-a77c-4cab8c2be8d3
sources:
  - kind: file
    ref: packages/agent/src/thread/run/ThreadHosting.ts
---
A hosted run (Claude Code over ACP, Cursor) never evaluates `beforeClose`: the vendor loop ends its turn and the run settles, so no closing rule reaches it. Native runs evaluate it on every clean text-only finish and take one more step when a rule guides.

Two rules lose their effect on the hosted road because of it:
- `run-budget` asks a reader that ended in text to call `answer` once. Measured on 2026-11-05 with `ask` from a Claude Code caller: 3 of 5 Haiku readers ended in text with no reminder, so `ask` labelled 3 correct answers `partial`.
- The collaboration closing reminder (`ThreadObligations`) that tells a child it still owes its final answer.

Outcome: when the vendor ends a turn cleanly (`end_turn`) and the run is not stopped, hosting evaluates `beforeClose` through the run's door with the run's state; if a rule guides, the guide goes into the same vendor session as the next prompt of the same Tagma run, and the run settles only when no rule guides. The reminded mark is the run's, so a reminder is given once per rule, as on native.

Done when a hosted reader that ends in text is reminded once in the same run and its next turn's `answer` closes its report, proved through the ACP fixture agent; and the note on hosting no longer names this as a difference from native.
