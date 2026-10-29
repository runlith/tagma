---
id: 01a16a01-a985-7ace-8887-1f7ba46632dd
title: "Compact navigation answer: unverified grouped by file with a cause, not a row per occurrence"
ord: 45
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16a01-d7cf-7781-8707-2d100a052763",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1612d-2135-7f12-8deb-91b934378e8f
sources:
  - kind: file
    ref: apps/tagma/server/src/navigation/contract/wire/operations.ts
  - kind: file
    ref: packages/navigation/src/answer.ts
---
The `uses` answer for a frequent name was filled with unverified occurrences: a separate position and excerpt for every word in `.svelte` files and scripts outside tsconfig. The answer must stay honest about the search boundary, but the agent needs these files' paths and the cause — not hundreds of outside-code excerpts.

Done in the kit contract before answer storage and paging:
- `no-adapter`, `no-program`, `unparsed`, `degraded` — one `boundary` row per file and cause with an occurrence count; these occurrences' positions and excerpts are dropped.
- `changed`, `untyped`, `unclear`, `alias-cut` stay as positions with excerpts: the agent reads its own current edit, traces a value's origin, or continues an alias chain at a concrete place.
- Outside symbols keep only the match and symbol counts; the top-10 names and frequencies are dropped, since the agent looks for the target's places and never acts on outside names.
- True places keep their form, enclosing function, `via`, and excerpt; line/comment counters and outside-code occurrence counts, `partial`, revision, lag, warming, stale, and project problems are kept. The full `summary.boundary` is on every page, including a page with no confirmed places; `kinds` does not filter it. `total` counts ready rows; one file boundary is one row.

Text and JSON use one `Answer`; `definition` and `uses` declare the same schema. The app shows the shared modelText or the serialized payload through `ToolXRay` and requires no position on every row. Both operations' descriptions, the spec's "Answer" and "Pages" sections, and the explanation above the code are updated.

A single-sample measurement on a live runlith checkout on 2026-10-23, macOS arm64: the launcher's own TypeScript 7.1.0-beta engine plus the public `Navigation.ask` kit, then the regular `NAVIGATION_PAIRS.uses` voice. `GOMEMLIMIT=6 GiB`, `GOMAXPROCS=3`, `GOGC=50`; ripgrep serialized, no more than three child processes at once. The full answer with no page or output-envelope cut; symbols are `string.length`, rows split on `\n`. The live server and `navigation.enabled=false` were unchanged. Before: one run on snapshot `f37cec4565a3.1`; after: `held` from the first run plus the remaining questions from a completed separate run on `97ab7be54255.1`. This is a sample of a moving shared checkout, not a stable benchmark of time: while the questions ran, neighbouring tasks changed sources and HEAD. The numbers differ from the original sample on task 84fe87b971; the measurement script itself is also visible to the engine as a file outside tsconfig.

| Question | Before, chars / rows | After, chars / rows | Symbol places before / after |
|---|---:|---:|---:|
| `TokenStore.held` | 46 161 / 323 | 11 398 / 113 | 21 / 21 |
| `TokenStore.get` | 64 233 / 463 | 18 996 / 196 | 23 / 23 |
| `TokenStore.find` | 66 463 / 400 | 18 199 / 204 | 8 / 8 |
| `TokenStore.accounts` | 23 058 / 149 | 7 336 / 70 | 23 / 23 |
| `TokenStore.remove` | 17 329 / 118 | 7 729 / 71 | 16 / 16 |

JSON before / after, chars: `held` 65 621 / 16 949; `get` 91 550 / 27 758; `find` 89 325 / 26 263; `accounts` 32 384 / 11 164; `remove` 24 811 / 11 525. Each JSON document after is decoded with the public `Answer` schema. Confirmed places kept their count at 21/23/8/23/16; language folding does not change them: e.g. `find` has 333 no-adapter occurrences in 166 files both before and after. Other causes move with the checkout: in the interrupted run `get` had 143 `unclear`, in the completed one 15. So the table measures these runs' real answers, not an isolated algorithm speedup.

Checks: red→green through the public `Navigation.ask/page` with a real ripgrep and an adapter double; the resulting 8 tests are green, including folding of several occurrences, kinds with no confirmed places, and file boundaries past the cursor with the full summary on the first page. The kit typecheck passed. The shared server typecheck inspected the server, reported 111 errors in 40 outside files from concurrent work plus 8 git errors; navigation has no diagnostics; the command ended on the 10-minute limit. The first post-change measurement attempt also stopped on the 10-minute limit after the held/get answers; the remaining questions moved to a separate run. A green whole-server typecheck is not established.

Example for `TokenStore.find`: ten rows `patches/xterm-dynamic-storage.mjs:65:18 unverified (no-program) …`, `:67:32 …` onward with excerpts are replaced by one `patches/xterm-dynamic-storage.mjs unverified (no-program) ×10`. Eight confirmed places stayed as rows, and the boundary is visible in the summary.

The script is kept as `measure.ts` in the scratch of thread `01a16a01-d7cf-7781-8707-2d100a052763`; for the run it stood at `packages/navigation/src/.nav-measure.ts` in the navigation package, command `bun src/.nav-measure.ts` from the package, continued as `bun src/.nav-measure.ts get find accounts remove`. Raw command answers: `e124fcde-6e7c-487d-8a51-c2c1e5058cfb:167` before, `3dacdd7f-babb-465e-932d-d268e202202d:167` after up to the limit, `e68f6520-d2a1-4e25-8fcf-1e95395bba4e:167` completed remainder. Removed from the checkout; its processes are closed.

One independent review on openai-oauth/gpt-6.1-sol xhigh: no findings; it covered the whole question and page path, JSON, text and the shared feed renderer, pass cost, and the sufficiency of public tests. The reviewer ran no tests/typechecks and changed nothing.
