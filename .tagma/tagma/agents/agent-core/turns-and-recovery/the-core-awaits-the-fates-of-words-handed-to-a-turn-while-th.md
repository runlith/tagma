---
id: 01a16042-de8f-76ff-9890-20cec69de975
title: The core awaits the fates of words handed to a turn while the transport holds the turn; a released turn with no fates takes its words off the books
ord: 15
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/agent/src/thread/run/WordsInFlight.ts
  - kind: symbol
    ref: packages/agent/src/thread/run/scheduler/RunScheduler.ts
    symbol: runSchedulerLayer
---
The core waits for the fates of words handed to a turn while the transport holds that turn; a released turn with no fates takes its words off the books.

A transport with words by receipt (`words: 'receipt'`) takes the turn's words — launch seed and steers via `deliver` — and owes each one a fate (`RunReports.fate` or in the end entry). Until the fates arrive, the next turn does not open: whether the words return to the queue depends on the agent's answer (`WordsInFlight`), and an Enter in between queues a word.

A fate can arrive after the turn end — for example a refusal on a cancelled-turn steer — but only while the transport holds the turn (`holds`). The wait ends on a fact: the last fate or the transport leaving the turn. The follow-up wake on the end checks the holder; if it still holds, the core checks it on the heartbeat tick (`ThreadLeaseRhythm.heartbeatIntervalMs`) until it lets go, then takes the remaining words off the books while leaving their inbox state as is. Without this, a transport that never reports fates (as the terminal did for a word typed into a not-yet-raised CLI) would hold the thread's words `queued` forever, and the next turn would never open.
