---
id: 01a16483-20a1-7981-bbae-26fb820c1411
title: A session's commit is published to subscribers at the end of the landing, after the lease is released; a subscriber failure goes to the log, not into a refusal
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/landing/commitLandings.ts
  - kind: file
    ref: apps/tagma/server/src/landing/contract/service/commitLandings.ts
---
The lower module does not know `threads`, but a subscribing thread needs the session's commit, so `CommitLandings` is a `landing` port: the subscriber receives `{threadId, projectId, commit, subject}` and unsubscribes with the returned function. The event is tied to the fact of the commit, not to the receipt: `submitHeld` remembers the commit as soon as it is published, while `submitWork` publishes it in `onExit` — only after the `Holdings` and `Retirement` leases are released — so a subscriber that waits or itself heads into a landing neither holds it nor can deadlock in it. The event thus goes out exactly once, including when the call was interrupted or the landing's later bookkeeping refused after the commit had already landed; a landing with no commit (`nothing`, a refusal before publication) publishes nothing.

Subscribers are called by the shared `subscribersOf` from `platform`: a subscriber failure, including a synchronous throw, is written to the log and does not change the landing — the commit exists by then, and it cannot be rolled back over someone else's listener. `projectId` is the thread's home (`origin.work`), not the calling graph's project: paired with `threadId` it is the thread's address.

The service lives in the module's installation lifetime: a subscriber and the publishing act receive the same listener set, while a set on a copy or on a call would diverge.
