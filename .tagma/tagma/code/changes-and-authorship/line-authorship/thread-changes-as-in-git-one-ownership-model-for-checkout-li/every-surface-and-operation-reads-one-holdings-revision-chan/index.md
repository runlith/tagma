---
id: 01a1166f-7113-7752-b6b9-0a77762eb07f
title: "Every surface and operation reads one Holdings revision: Changes panel, badge, status bar, Git tab, read_changes, read_checkout, submit_work"
ord: 6
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/CheckoutTenant.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/FilesColumn.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/ThreadFiles.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/Row.svelte
  - kind: file
    ref: apps/tagma/server/src/change-record/operations/changes.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/feed.ts
  - kind: file
    ref: apps/tagma/server/src/threads/list/threadList.ts
---
Every surface shows one Holdings revision, and no surface computes ownership itself.

## What stands now

- **Three independent client channels — three numbers on one screen:**
  - the thread list row: `heldPaths` from `HeldCounts`;
  - `changes.subscribe` → `ThreadFiles.svelte.ts`: the panel and its button counter (`ChangesToggle.svelte`, `files.uncommitted`);
  - the checkout line → `Selection.svelte.ts` `paths`: the status bar.
- **Every `changes.subscribe` frame is the whole list** of files and commits. The server rebuilds it from scratch on any root fs event, for every open panel.
- **Panel:**
  - never reads `stale` and writes "No changes yet" on failure and before the first frame alike;
  - `+N/−M` in a line is the whole file diff;
  - the `status !== null` filter hides paths whose bytes equal HEAD.
- **The thread's commit list** recomputes on every panel cycle: `ThreadFiles.commits`, up to 3,100 times per hour.
- **The Git tab's group-by-thread** follows the checkout line's holders: "a line exists, so it holds".
- **`composeAgent` (`written`)** takes the files the thread wrote with its own `writtenOfThread` query: p50 256 ms, a plan scanning on `project_id`.

## Server: channels

- **`holdings.subscribe(checkout)`** — the checkout's Holdings ([[fe04fc30]]).
  - First frame whole, then changes: `revision`, changed and departed `Holding`s, totals, `state`.
  - Until changes reach the client, the server keeps only the last `Holding` per path, so a slow client gets compressed, not a queue.
  - A new subscription is a whole frame.
- **`thread.changes(threadId)`** — the thread's projection of the same revision of every checkout where the thread holds lines or stands:
  - *Uncommitted* — proven paths where the thread is in `hands`, except ignored: they live only in "Outside git";
  - *Could not verify* — paths where the thread is in `writers`, with a reason;
  - *Outside git* — its ignored paths;
  - *Commits* — commits its lines are stamped with that are reachable from HEAD, as now. Recomputed only on a HEAD shift or a new stamp of the thread's lines;
  - *How the lines ended* — totals by reason: overwritten by whom, returned to HEAD, left with no commit. Details live in `read_changes`;
  - each checkout's `state`.

  Changes go out as in `holdings.subscribe`. The channel replaces `changes.subscribe` and `ThreadFileList`.
- **The thread list row** carries `held: { paths, unproven }` — the thread's totals over every checkout. It leaves only when they change and replaces `heldPaths`.

## Client

- **One store per channel:** `ThreadChanges` (thread tier) on `thread.changes`, `Holdings` (graph tier) on `holdings.subscribe`. Stores apply changes and never derive ownership themselves.
- **Changes panel.**
  - Sections: "Uncommitted" (by checkout groups when more than one), "Unclear authorship", "Outside git", "Commits", "How lines ended" (collapsed).
  - A file line: the thread's own `+/−`, the git letter, who else holds lines in the file.
  - "No changes yet" — only on `current` with zero in every section.
  - On `stale` — the last list, the reason, and "Retry".
  - Before the first frame — nothing.
- **The sidebar badge and panel button** show `held.paths` apart from the unclear-authorship path count (`unclear authorship`). A thread Peek reads the same `ThreadChanges`, names the touched paths and reasons, and opens the right checkout's diff on press. The subscription stays held while a Peek with such paths is open; surfaces never derive ownership.
- **Status bar** — the checkout Holdings totals: changed paths, "· M yours" (`CheckoutTotals.operator` — paths with the operator among holders), "· N unowned", "· N unverified". The interface is English: "yours", "unowned", "unverified". While `Holdings.row` lags the checkout line's revision, the total comes from the line (the git path count) marked "updating".
- **Git tab.**
  - Git lines come from the checkout line, holders and nobody lines from Holdings by path.
  - "By holder" grouping (`By holder`) on `hands`; the operator's lines are the first group "Your changes".
- **Operator among holders** — "You" in the thread panel ("Also held by"), in the Git tab, in the diff panel (`read_authorship` returns `author: {holder, agentName}`, the operator has its own mark); `operator` in agent answers.
  - While `Holdings.row` lags, holders are marked "updating".
- **Diff panel** — `read_authorship`, i.e. [[359519e0]] marks.

## Agent operations

- **`read_changes`**
  - `{agent}` — the thread's slice, like `thread.changes`: paths, its lines, who else holds, verdict; commits; totals by reason. Plus per-turn history, paged: which paths each turn wrote and what stands of them now — holds, committed (by which commit), left (by which reason). This is the old "own WORK newest first", but derived, not raw record lines.
  - `{path}` — the path's `Holding` and step debts on it.
- **`read_checkout`** — the checkout line and every path's Holdings state, through the `CheckoutHoldings` port at answer time.
- **`read_authorship`** — [[359519e0]] marks.
- **`submit_work`** — the answer names:
  - `committed` — paths whose lines this commit carried away;
  - `left` — own lines that still stand;
  - `carried` — other holders’ (archived) and nobody lines that rode along;
  - `owed` — step debts;
  - `edited` — hook edits that entered the working files.

  Refusals: `lines-held` with names (`operator` for operator lines, and then the first `unblock` is asking the operator to commit or landing with `taking: ['operator']` on the operator's word), `walk-cut` on `unknown` without `whole`, `reshape-unreadable`.
- **`check_rules over: change`** — the same judge and the same commit version as the landing.
- **Worktree archive** takes holders from `CheckoutHoldings`.
- **`composeAgent` (`written`)** answers a different question — "which files the thread wrote in its life" — for delivering law on touched files. This is history, not ownership. A query on the `(thread, path)` index answers ([[f16c4571]]).

## Texts that change (d82432e6: the text says what is)

| Text | Owner | New |
|---|---|---|
| `submit_work` description (`carried`, `edited`, `kept`, "where they cannot be separated") | `landing/contract/wire/operations.ts` | the answer fields above, region separability, `lines-held` |
| `commit_checkout` description ("`kept` the files left as they stood") | `landing/contract/wire/checkoutCommits.ts` | `owed` and step debts |
| `read_changes` description ("own WORK newest first, committed rows included") | `change-record/contract/wire/operations.ts` | the Holdings slice and per-turn history |
| `read_authorship` description ("a line more than one record claims is nobody's", "replays disagreeing") | `change-record/contract/wire/operations.ts` | one mark per line, last writer |
| `read_checkout` description (holders) | `workspace/contract/wire/checkoutReads.ts` | path state from Holdings |
| `revertLines` rollback parameter | `threads/contract/wire/operations/turns.ts` | returning the source marks |
| landing doctrine | `landing/doctrine/gitAndGithub.ts` | landing answer and step debts |
| shared-checkout doctrine | `change-record/doctrine/theSharedCheckout.ts` | `read_changes {path}` answers Holdings |
| voice tools | `native-harness/voice/sessionTools.ts` | new `read_changes` fields |

## Acceptance

- **Today's scenario** — 30 thread paths, a batch past 256 KB, the worker in place, 15 nobody's. Badge 30, panel-button 30, panel 30, status bar "45 changes · 15 unowned".
- **One unproven path** — badge "29 files · 1 unclear authorship", panel: 29 in "Uncommitted" and 1 in "Unclear authorship" with a reason.
- **A thread with paths in canonical and in a worktree** — the badge equals the sum, the panel shows two groups.
- **One path edited** with panel and Git tab open gives one change with one `Holding` in each channel.
- **On `stale`** the panel never shows "No changes yet".
