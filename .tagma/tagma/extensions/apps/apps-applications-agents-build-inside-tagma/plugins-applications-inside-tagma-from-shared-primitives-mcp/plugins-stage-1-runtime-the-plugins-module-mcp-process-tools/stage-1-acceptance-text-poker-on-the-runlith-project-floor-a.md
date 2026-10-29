---
id: 01a12306-efba-7a0e-94d7-05f05ced9ad0
title: "Stage 1 acceptance: text poker on the runlith project floor and a 9-player table measurement"
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1234b-6a18-72ce-a01b-55e251cd2681",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1227f-7522-78e3-a658-79b7a0a16218
  - kind: waits-on
    to: 01a12306-efba-7a0e-94d7-05edec9d1962
  - kind: waits-on
    to: 01a12306-efba-7a0e-94d7-05eed6340847
  - kind: waits-on
    to: 01a12306-efba-7a0e-94d7-05ef511bce7b
---
The runlith project's `.plugins/poker/` plugin: a dealer process, players on different models, a human moves with a tool. The spec's acceptance rule: only the plugin package's changes; when Tagma is missing something, the lacking contract returns to its owner.

Players are born by root `create_thread` with `bindings` on the plugin key and woken with `start_turn`, not as the thread's children: the root call follows spawn semantics. `create_thread` is not idempotent — the dealer stores player thread ids in its data folder and does not recreate them after a restart.

Check: a player sees only its own cards; the table survives a process restart; no second dealer appears after an edit. Measure: 9 players and a dealer, 50 hands with no stalls, CPU, event-loop lag, and memory per idle thread. `@runlith/llm` has no limiter on parallel account requests; there is retry with backoff and `retry-after` on 429 and overloaded. The measurement records the 429 count and waits; a limiter is added only if they stall the table.

## Acceptance result

The plugin package — commits f9d7a155d5 and 22e93130d1 (`.plugins/poker/`, its own package.json). All three properties verified live on a separate Tagma instance (port 5953, its own data directory): a player sees only its own cards (572 texts in 90 threads of a 50-hand table — not one opponent's hole card); `kill -9` on the dealer and a plugin-file edit mid-hand — the table continues, exactly one process; a six-step restart and at-least-once thread ending hold. Players are born by root `create_thread`, taking the model from the agent definition's `model:` (after fix 3cde0f52; before it root birth ignored `model:`).

Measurement: 9 players on `muse-spark-1.3` low, 50 hands, player-thread rotation every 5 hands (`renewEvery`), 588 decisions over 1544 s (≈31 s per hand), the table completed all 50 hands. Stalls: no auto-acts, no wrong moves, no decision-timer fires; one turn ended with no act (dune) and was reminded. Limits: no retry records in 90 threads, so zero 429s and retry-after waits, no limiter needed. Tokens: 573 runs, 6.47M input (of it 5.71M cache read), 0.14M output; Muse has no price in the repo, not converted to dollars.

The Tagma server (one sample, the machine busy with other sessions, load average 13–18 on 12 cores): CPU 0.26 cores average (p95 0.39, max 0.49); event-loop lag p99 median 10 ms, in 86 of 308 five-second samples a break over 100 ms, the server loop recorded 206 halts (median 152 ms, max 2.6 s), while the loop itself counted only ~4% of the window — the delay is not its own computation. Idle control on the same load after the table: 18 halts over 187 s, 5 of 37 samples over 100 ms, CPU 0.04 cores. RSS 382→581 MB (max 731), heap 158→207 MB (max 364), idle after the table 412 / 102 MB. Memory per idle thread: 600 created idle threads raised heap from 80 to 81 MB. Dealer: over 1563 s CPU 7.7 s (≈0.5%), RSS 44 MB, heap 8 MB, loop lag p99 29 ms (max 925 ms); start_turn p50 64 ms, p95 582 ms (max 6.6 s), create_thread p50 43 ms, act p50 0.9 ms.

Without rotation a player's context grows ≈1k tokens per decision and cost grows with the square of the hand count; so `renewEvery` defaults to 5. The dealer does not hold historical tables in memory (reads by id from storage), the list of a seat's former threads is capped at 8.

What the Tagma contract lacked: root `create_thread` did not take the agent definition's `model:` (fixed by 3cde0f52); a plugin tool cannot be called from outside an agent session (the table was opened through a helper thread-agent); nothing can stop the table from outside an agent. The dealer does not delete rotated threads: thread deletion is unavailable to a plugin.
