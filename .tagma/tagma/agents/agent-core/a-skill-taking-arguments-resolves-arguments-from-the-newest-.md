---
id: 01a18919-cdcc-7cae-a604-4852cbbf5377
title: A skill taking arguments resolves `$ARGUMENTS` from the newest reader message requesting it, at load and at the loaded check alike
ord: 201
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/agent/src/agent/AgentSkill.ts
  - kind: file
    ref: packages/agent/src/agent/AgentSignal.ts
  - kind: file
    ref: packages/agent/src/thread/compaction/projection.ts
---
A skill marked `arguments` (a plugin command) gets `$ARGUMENTS` replaced inside `resolvedInstructions` with the text of the newest message whose `$<id>` reference requested it, minus that reference. The same function decides both what `load_skill` returns and whether a delivered payload is still current, so the explicit-request rule and the tool gate see a load as done exactly when the payload matches the current request; a later request with other words makes the old payload stale and asks for a load again.

The requesting text has to survive where the message itself does not: an envelope message carries it as `readerText` beside `readerSkills`, and the compaction head copies both from the last requesting message it folds. Without the text, a request carried over a fold would resolve to empty arguments and never match the payload already in history.