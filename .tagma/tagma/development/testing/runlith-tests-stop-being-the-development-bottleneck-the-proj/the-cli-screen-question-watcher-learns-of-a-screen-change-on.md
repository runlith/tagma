---
id: 01a17b6d-15b2-73f9-a97f-32451f1dd0fa
title: "The CLI screen-question watcher learns of a screen change on a quiet 5 s beat: the question stands late, the terminalConformance test waits 10 s for it"
ord: 67
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16e20-3dd6-7696-901e-d29696ccb336",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a17b46-3468-743a-b806-e20a1c68fa2e
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/asks/screen.ts
---
`HarnessScreenAsks` polls the CLI screen: 250 ms while an unannounced question stands on screen, 1 s while words wait for the screen, and `QUIET_BEAT_MS` = 5 s in all other cases. A question the CLI draws between two quiet beats reaches the operator up to 5 s late. The `terminalConformance.itest.ts` test "an answer to a CLI screen question the CLI has already left…" waits out two such beats: 10.7 s wall at 0.9 s CPU. When the beats were driven by the `TerminalScreens.screens` subscription, the test ran 1.2 s.

The subscription was rejected at review and never landed. After every output chunk the host encodes a full frame or patch for the subscriber, and the server decodes it and throws it away. Beats with their own screen read, store, and `terminals.record` would run 4 times a second the whole time the CLI animates. A 250 ms floor at the consumer is a throttle over the producer (rule 2393aff1). The reviewer found two more problems: when the subscription drops, the task never resubscribes, and interrupting the old task waits for the `Subscribed` answer under the shared `jobsHeld`.

What is needed is an event at the producer: the host reports that the screen changed, without a frame (one revision), or the watcher judges the question on the delivered frame and does not read the screen a second time. Until that is decided, the cost is measured on several CLIs mid-run.
