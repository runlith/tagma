---
id: 01a165c5-bb3c-73dd-9736-f06f73e80a0f
title: A `uses` question with thousands of places (`Effect.fn`) answers with no multi-second pause, cold and warm
ord: 42
tags: ["task"]
fields:
  {
    "holder": "tagma:01a165ac-1866-759f-9392-e4764cb209c7",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a165ab-b9dc-755f-a901-7f9ac195d7ed
  - kind: implements
    to: 01a1612d-2135-7f12-8deb-91b934378e8f
sources:
  - kind: file
    ref: packages/navigation-ts/src/engine/semantics.ts
  - kind: file
    ref: packages/navigation-ts/src/engine/workspace.ts
---
Measurement [[c195d7ed]] on runlith (own engine process, one sample): `uses Effect.fn` — 4465 places, cold answer 71 s, repeat 2.2 s; `Layer.effect` — 1309 places, 27 s cold and 6.2 s repeated. Owner lookup takes fractions of a second; time goes to `judge` over thousands of candidates and cold opening of closed programs those candidates need (lazy programs, note [[6abda76b]]).

The spec [[34378e8f]] allows no multi-second pauses except the very first question to a checkout. A frequent owner (`Effect`, `Schema`, `Layer`, `Stream`) is an ordinary agent question on Effect code.

Goal: a question with thousands of places answers within the spec's target both cold and warm — the layout (what to open, how to judge thousands of candidates, what to hand out first per page) is chosen by measurement; precision does not drop silently. Acceptance: `Effect.fn`, `Schema.Struct`, `Layer.effect` times cold and warm before and after on runlith, recorded in the task.

## What was done

The warm-pause cause is the recent-question window. A question about a frequent owner sends `locate` to every module importing the owner (94 for `Layer` in runlith), and a shared twelve-call window pushed out its `judge` programs: each `locate` closed them, and the question's repeat reopened about 60 programs cold. Now `locate` and `judge` each hold a twelve-wide window, and the same question stands in the window once, last ([[6abda76b]]).

## Before/after measurement

One sample: macOS arm64, 12 cores / 32 GB, TypeScript 7.1.0-beta, `GOMEMLIMIT` 8 GiB, `GOMAXPROCS` 4, `GOGC` 50, load average 4–9. Runlith clone at 3030142fc2, own engine process through the launcher and navigation kit with ripgrep (`owner.ts` and raw `owner-*.jsonl` lines in the scratch of thread 01a165ac-1866-759f-9392-e4764cb209c7). "Before" is the engine at 6924234536 (program order and window unchanged since until this work). Sequence after load: narrow `uses release` question (closes unneeded programs), then `Layer.effect`, `Layer.effect`, `Effect.fn`, `Effect.fn`, `Schema.Struct`. Time is the whole kit question, adapter `judge` in parentheses.

| Question | Before | After |
|---|---:|---:|
| `Layer.effect` cold (16,165 positions, 1305 places) | 14.5–18.1 s (13.5–14.1 s) | 10.4–17.3 s (7.2–11.9 s) |
| `Layer.effect` repeated | 14.3–17.3 s (13.5–15.3 s) | 1.0–4.1 s (0.17–0.39 s) |
| `Effect.fn` first (4855 positions, 4465 places) | 4.3–6.1 s (0.3–2.7 s) | 3.4–6.9 s (0.5–2.9 s) |
| `Effect.fn` repeated | 1.2–1.6 s (0.12–0.14 s) | 1.3–1.8 s (0.09–0.18 s) |
| `Schema.Struct` repeated (4084 positions) | 0.8–1.0 s (0.09–0.10 s) | 0.6–0.8 s (0.07–0.12 s) |
| engine memory after the series | 4.6–5.2 GiB | 5.9–6.8 GiB |

Spread within a column is question order and machine load: the 4.1 s `Layer.effect` repeat was taken at load average 9, 0.4 s of it the engine.

`Effect.fn` and `Schema.Struct` repeats never reopened programs before either: their owners import from 2–4 modules. The price is memory: the twelve latest `judge` programs stay open, and after `Layer.effect` the engine holds 1.5 GiB more; the upper bound is all checkout programs, as right after load.

What stays cold and why:
- cold `Layer.effect` is 7–12 s in the adapter: 5289 files with candidates, 3656 of them only lines (`from 'effect'`), but the engine still receives them whole (~4 s of AST transfer), and files with real candidates lie in 49 programs, with each cold checker costing ~150 ms (~8 s). Only a pre-engine string cut can shrink it — a code-fact syntax filter in the kit — and that would remove 15 programs and ~4 s;
- 94 `locate` calls of a cold `Layer.effect` go one by one and open one program each — 4.4–5.9 s; that is the kit-to-adapter question order;
- a warm frequent-owner question spends 0.5–1.2 s in the kit (ripgrep over the whole checkout and owner analysis), not in the engine.

Measurement [[c195d7ed]] (`Effect.fn` 71 s cold, `Layer.effect` 27 s / 6.2 s) was taken on a live checkout; here a cold `Effect.fn` cost 4–7 s, and 71 s did not reproduce.
