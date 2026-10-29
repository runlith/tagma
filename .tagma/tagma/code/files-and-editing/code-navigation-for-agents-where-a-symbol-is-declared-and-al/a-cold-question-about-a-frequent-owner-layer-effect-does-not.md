---
id: 01a165e5-cd2c-7831-8362-976a6bb98558
title: A cold question about a frequent owner (`Layer.effect`) does not open programs for `locate` and rows
ord: 43
tags: ["task"]
fields:
  {
    "holder": "tagma:01a165ac-1866-759f-9392-e4764cb209c7",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a165c5-bb3c-73dd-9736-f06f73e80a0f
  - kind: implements
    to: 01a1612d-2135-7f12-8deb-91b934378e8f
sources:
  - kind: file
    ref: packages/navigation-ts/src/engine/semantics.ts
  - kind: file
    ref: packages/navigation/src/navigation.ts
---
After [[73e80a0f]] a repeat question about a frequent owner is warm (`Layer.effect` on runlith takes about 1 s), but the first cold one is not: 10–17 s on one sample. The same measurement broke it down:

- 94 `locate` calls — one per module importing `Layer` — run one by one, each opening its program cold: 4.4–5.9 s, although most of these programs are not needed by `judge`;
- of 5289 files with candidates, 3656 contain only strings (`from 'effect'`), yet the engine receives the AST of each (~4 s transfer) and opens 15 extra programs for them;
- files with real candidates live in 49 programs, and each cold checker costs about 150 ms (~8 s); this is the floor while a file is judged in its own program ([[2d4f708a]]).

What to try, per measurement: syntactic filtering of string/comment occurrences before the engine — with the code facts the kit already parses for owners (spec [[34378e8f]] assumes this), keeping the "in string" verdict with one owner ([[51c66cb6]]); `locate` of the owner first in a program that is already open or needed by `judge`. Accuracy never drops silently. Acceptance: cold `Layer.effect`, `Effect.fn`, `Schema.Struct` on runlith before and after, recorded in the task.

## Done

- **Import-group `locate` stops at the first file where the owner resolves.** The adapter answers `resolved` next to the candidates. Previously the kit walked files until the first answer *with a member*. So `Layer` from `@runlith/layer`, which has no `effect`, walked all 88 importing files, each in its own program. Now `uses Layer.effect` performs 7 `locate` calls instead of 94. An empty answer from a file changed after the snapshot does not stop the walk.
- **Owner files are found through `rg --files-with-matches`.** Previously this used a `--json` pass, and at a frequent owner (`Effect`) that is 72k rows and 23 MB of JSON the server parsed on the event loop.

## Measurement

Stand: a runlith clone at 3030142fc2, its own engine process (`GOMAXPROCS=4`, 8 GiB memory limit). The script and raw `owner-*.jsonl` are in the scratch of thread 01a165ac. Each run is one sample; the machine is loaded by other agents (load 5–23), so the figures are noisy.

| question | before | after |
|---|---|---|
| `Layer.effect`, first in a fresh engine | 15.7–17.6 s (load 5) | 13.7–15.1 s (load 5–6) |
| `Layer.effect`, repeat | 0.8–2.4 s | 0.8–1.2 s |
| `Effect.fn`, first in a fresh engine | 10.3–15.1 s (load 10–16) | 8.3–10.2 s (load 9–19) |
| `Effect.fn`, repeat | 1.0–2.1 s | 0.7–0.9 s |
| `Schema.Struct`, first / repeat | 4.8 / 0.6–1.2 s | 4.7–4.9 / 0.5–1.2 s |
| memory, peak / after 40 s idle | 4.7–6.1 / 4.0–5.0 GiB | 4.3–5.4 / 4.0–5.0 GiB |

Kit time in a warm question is about 0.6 s before `judge`. Almost all of it is three ripgrep passes running together: 0.2–0.6 s under load vs 0.14 s for a single `rg`. Owner parsing from memo costs 0.05–0.1 s.

## What is left and why

- **A cold question about a frequent owner bottoms out in TypeScript.** The Go profile for a cold `Layer.effect` is: `judge` runs 10–13 s, of which about 2.4 s opens 48–59 closed programs (TS re-parses their files) and the rest is cold checkers of the 49 programs holding real candidates plus Go garbage collection (over half the CPU). With `GOMAXPROCS=8` the time is the same: the API answers requests almost sequentially. The only way to remove this cost is to keep programs open, and that is memory.
- **Filtering string occurrences in an import's module before the engine was tried and dropped.** In measurement it saved almost no time: the cost is opening programs and checkers, not AST transfer. It made a repeat question 0.1–0.15 s more expensive because it re-read and re-hashed about 5k files each time. Review found it confused an `obj['x']` key with a module string on the same line and produced a second-owner "in string" verdict next to the engine's.
- **Cold owner parsing runs on the server event loop.** It is 1.5–1.9 s over 4.4k `Effect` files, synchronously; repeats come from memo.
- **Memory is unchanged by this work.** A warm frequent owner holds about 50 programs with checkers.
