---
id: 01a15f9a-2d81-79c1-bc33-35ac0de9ddf6
title: "The native turn is stopped by the core RunStop: every step wait is cut by it, and a stopped turn's call answer does not wait for release"
ord: 11
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a15eeb-6b48-7ca8-9c93-24d7bd56424f
sources:
  - kind: file
    ref: packages/agent/src/agent/AgentCalls.ts
  - kind: file
    ref: packages/agent/src/agent/AgentRunner.ts
  - kind: file
    ref: packages/agent/src/agent/AgentTurn.ts
  - kind: file
    ref: packages/agent/src/agent/RunStop.ts
---
The stop on a run is one — the turn holder's `RunStop` in `RunExecution`. The native transport hands it to the loop (`AgentRunParts.stop`), and the loop binds it to `AgentCalls` (`bind`): a spoken stop synchronously declares the run's open foreground calls stopped, and a call opened later is born stopped. There is no wait after the stop: the loop ends as soon as it reaches the stop and hands the tail to the feed.

Every step wait goes through `RunStop.cut`: the context boundary, the model route request, projection, reading waiting words, step and closing rules, downgrade, the model stream, spend observation, the continue decision and the retry pause, restoring interrupted calls, tool claims, aside capture, checking unread words. A call whose claims the stop cut is answered `cancelled` as never started. Not cut: writing the feed tail (buffer, part ends, `run-abort`), writing call intents (`commitEffects`), and door answers to stopped calls: the step fold waits for them so history receives every call's outcome.

`cut` waits for the interrupted wait's abort to finish, so an uninterruptible section under it runs to its end. Thus a journal write started by reading words (tail flush and transition with word confirmation) lands whole together with the stream writer's wait — the same writer the turn-end write needs; when it lands, the words count as delivered to this run, as with a stop right after the read. The door answer to a stopped call includes the tool's own interrupt and its read-back: they yield the call's outcome, not resource release.

Whoever waits for a call stopped together with the turn (`run-abort`) receives the answer as soon as it is known — after the body or its interrupt and read-back — without waiting for `release` (releasing the call's holdings: world, output) and handoff into the background, wherever execution is; the call's entry ends when the release ends. Answers of other stops and the ordinary answer wait for release: the turn continues, and the next step must not find the call's resources busy.

The native transport's `interrupted` receipt is a spoken stop, not a completed cut: the cut arrives when the current loop wait's interrupt finishes — for a model stream, its closing; for a journal write and a door answer, their end. Waiting for the cut inside `abort` is impossible: the stop at the step boundary (`checkpoint`) is executed by the loop from inside its own boundary, and waiting would close on itself. So that stop's `halt` is uninterruptible: the boundary's cut does not abort its own request write.
