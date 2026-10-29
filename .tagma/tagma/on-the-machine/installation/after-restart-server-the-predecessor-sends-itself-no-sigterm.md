---
id: 01a14d01-bc76-7301-bb15-98a5955549e3
title: After `restart_server` the predecessor sends itself no SIGTERM, and the successor waits for the leaving forever
ord: 52
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c68-ea98-7334-8861-317dd11a1f05",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14c18-c833-7d88-b3bd-66ef5b12dbe8
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/process/succession.ts
---
Reproduced twice on tagma:try (working-tree build 2026-10-18 ~05:00 and ~05:08). After `restart_server` the predecessor writes the `accepted` and `standing-by` points into `restart.json`, then nothing. No `door-closed`, no SHUTDOWN_DEADLINE_MS deadline line: the SIGTERM handler never fired. The successor writes "pid N left <data> … so far" forever. A manual `kill -TERM` to the predecessor completes the handover in ~1 s.

**Cause (proven).** 2abe58c2fb moved the deferred SIGTERM into `Effect.forkIn(…, scope)`, where `scope` is the Succession layer's scope. But the server built that layer via `Effect.runSync(Effect.scoped(Layer.build(…)))`, and the scope closed right after the build. `forkIn` into a closed scope interrupts the fiber at once; no signal. A probe with the old build: "no signal within 1 s"; with an open scope — the signal in 120 ms. 4a2ce1e1c4 fixed the root (05:24, `successionScope` lives until the process ends). On the build with it, 8 of 8 restarts on tagma:try passed in 1–3 s; the debug log confirmed the fiber ran and the signal was sent. The itest a8e40cf2e9 catches the regression at the Succession level: with no signal it is red.

Initial suspicion: commit 2abe58c2fb replaced `setTimeout(signal, ANSWER_GRACE_MS)` with `Effect.forkIn(Effect.sleep(…) → signal, scope)`, where `scope` is the `processSuccession` layer's scope. If that scope is closed or a fiber in it does not start, there is no signal. Proof of the fix: the trial server's restart completes with no manual signal; the composition restart test.
