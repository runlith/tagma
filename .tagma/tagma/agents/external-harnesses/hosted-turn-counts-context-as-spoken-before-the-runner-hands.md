---
id: 01a17f7a-77f0-7df1-9ce3-3c3f6f57a121
title: "Hosted turn counts context as spoken before the runner hands it to the vendor: a cancelled or lost `open_hosted_turn` response loses context for the Claude session"
ord: 152
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17f55-8e93-7de8-8618-0a7d71ad6e56",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a17f5d-9e25-780b-9302-7f0783cb4628
sources:
  - kind: file
    ref: packages/hosted-runner/src/turn.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadHosting.ts
---
`ThreadHosting.open` (`open_hosted_turn`) records the turn context message and advances the world-state snapshot before the runner hands the context to the vendor: after the door answers, the runner still runs `session.prepare` and only then `session.start` (`external-harnesses/runner/hosted/turn.ts`). A cancellation in this window ends the turn `cancelled` with `tagma/turn.last: null`, and a lost `open_hosted_turn` response (an `unsent-only` retry) ends it failed; in both cases the Tagma journal counts the context as spoken, the next `open` does not repeat it, and the Claude session never saw it. Any ACP turn context is lost: the working note, the fork marker, graph changes, the step law.

Native has no such hole: the context is recorded in history, and the next model request carries it.

What to decide: where Tagma learns that the vendor received the context. Options are confirmation after `session.start` (two-phase opening), or the ACP projection on `last: null` removes this turn's context message from history and the "a message left history — say it again" rule (`lost` in `nativeTurnContext`) says it on the next turn. Found by review [[83cb4628]].
