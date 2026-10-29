---
id: 01a18919-cdcc-7cae-a604-4852cbbf5377
title: A skill taking arguments resolves `$ARGUMENTS` from the newest reader message requesting it, or the arguments a fold carried, at load and at the loaded check alike
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

The requesting text has to survive where the message itself does not. An envelope message carries it as `readerText` beside `readerSkills`. The compaction head keeps two things apart: `readerSkills` is still only the newest reader input's request set, so nothing already answered becomes an obligation again, while `skillArguments` carries the newest arguments of every skill requested anywhere in the folded part, and a later fold carries them on. Without that map, a command loaded after a fold — or after a newer message asking for another skill — would resolve to empty arguments.