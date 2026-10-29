---
id: 01a14cdb-52d7-7975-a4d8-f425959e8fe9
title: Merge needs a fresh checkout of the base before refusing or landing, not an observed line from before the file event
ord: 30
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c19-6c7a-788b-a8e4-4b267db89c68",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13f2d-638d-74e9-8a14-33acd1cc7192
sources:
  - kind: file
    ref: apps/tagma/server/src/landing/merge/integrate.ts
  - kind: file
    ref: apps/tagma/server/src/workspace/checkouts/rows.ts
---
Merge admission receives a fresh snapshot of the base checkout and a fresh judgement of its dirty paths' holders before refusing or publishing. The error predates the current native port: pre-wave `92dcbd9511` holds the same `integrate`, `rows`, and `CheckoutRows` contract; the failing queue scenario already had the same inputs and assertions. An observed line under a live watcher could lag behind written files.

The snapshot's owner, workspace, provides `CheckoutRows.refresh`: the next read's number and the shared tree's invalidation are taken in one synchronous step, completion is awaited regardless of revision change, the source Exit preserves failures. Merge calls this operation inside the existing root/base gates. The contract is explained in [[67a4bcb0|admission freshness guarantee]]. `CheckoutHoldings.holdersOf` in `change-record/holdings/judges.ts` receives the fresh `judge.judged(paths)` result, so a fresh dirty path is matched to fresh holders. Scope, named spans, and the read/follow observed semantics are preserved.

The [[01a14ce8-6f6e-7243-836c-08a720e4dfb6|lone independent reviewer]] on `openai-oauth/gpt-6.1-sol/xhigh` found two P2s: the scheduler window between ticket and invalidation and the existing stale holder read after the first settled. Findings verified along full chains and fixed at both producers; the second additionally reproduced by an owner test: `7b0e5d50-9e15-4443-b242-fd541c1e6828:167` red — `thread-mine` expected, undefined received; `3f2bfb9b-80dd-4a99-afeb-a91f3eccad1a:167` green. Fixes verified by the author, no second review. The scheduler's narrow window was not separately runtime-red reproduced; its edge is removed by the producer's synchronous step, and the owner test checks reading after an already-started old status, unchanged revision, and the source GitRefused.

The existing `WorktreeFinishing.stest.ts` in one file `--parallel=1`: red `407968ec-eb1b-45c3-ba29-b5f6bb0c359:167` — 10 pass / 1 fail; the producer fix gave 11/0 before assertion changes (`dc72f4f064-6640-42f6-813e-b8a11f083202:167`). Final execution `ac077979-d3a5-4fc2-83f3-a2f8118fa16e:167`: WorktreeFinishing — 11/0, 60 assertions, 49.01 s; checkout recovery — 4/0, 11 assertions, 3.68 s; production Holdings — 11/0, 41 assertions, 7.41 s, each file in sequence. The last attempt checks base-held, unchanged ref and held bytes, previous waiting, and worktree deletion. `bun check --threads=1` over the matching test entrypoints — 3242 files / 0 errors (`48752fde-16de-40ba-8a7d-71a73c55a117:167`).

Commit `9b421393544d98500ad1f4946b4e325c546bdc4f` holds nine related files. The commit step only moved the refresh signature lines; the result is read. The checks cover the named scenarios and type closure on the shared moving checkout. The snapshot pins a fresh read, while later external writes stay new changes; cost on large checkouts is not established by these local samples.
