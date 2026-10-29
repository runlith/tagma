---
id: 01a0d00c-da3d-7422-aa9c-16c33f529b7d
title: "Serve commits to the changes surfaces: thread commits in the thread frame, a pathless branch log, read_commit, and one commit's patch of a path"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d00d-4511-7d07-b6e7-dba398e59b1e",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0d00c-2ecf-7b08-9009-12944085a12c
sources:
  - kind: file
    ref: apps/tagma/server/src/harness/ThreadFiles.ts
  - kind: file
    ref: apps/tagma/server/src/worktrees/CheckoutReads.ts
  - kind: file
    ref: packages/git/src/history.ts
---
Implements the server half of [[4085a12c]]; the client half runs in parallel against the exact shapes below. Deviating from a shape breaks the client: raise it with the client builder first.

## Build

**1. Thread commits in the thread frame** (`harness/ThreadFiles.ts`, `protocol/checkoutStatus.ts`, `socket/rpc.ts`, `socket/changesChannel.ts`)
- **Protocol.**
  - `ThreadCommit = Schema.Struct({ sha: NonEmptyString /* full */, subject: String, author: String, date: NonEmptyString /* author date ISO, as HistoryCommit */, files: Int /* the thread's stamped paths in it */ })`.
  - `ThreadFileList` gains `commits: Schema.Array(ThreadCommit)` and `moreCommits: Schema.Boolean`.
  - The `changes.subscribe` payload gains `commits: Schema.optional(Int > 0)`: default 30, ceiling 100 (measured in the decision, §14).
- **Selection.** Distinct `workspace_change.commit` values of the thread's rows under the same `carriedIn(origin)` narrowing `landedOfThread` uses, newest `committedAt` first.
  - Keep only commits reachable from the root's HEAD. A commit amend or rebase took off the branch is not listed, and a sha git no longer has is not listed.
  - Cut to the limit; `moreCommits` says whether another reachable one stands past it.
  - `files` counts the thread's distinct paths stamped with that commit.
- **Caches.**
  - Metadata (subject, author, date) comes from git once per sha: a sha's metadata never changes. Cap the cache by entry count (2,000), oldest out first.
  - Reachability is cached per HEAD and dropped when HEAD moves.
- **Failures.** A metadata or reachability read that fails leaves that commit out and marks the frame `stale`, as a failed reading already does. Never publish an empty subject for an unread one.
- **Freshness.** A commit must reach the frame without any further edit. Today a HEAD move marks the root, but discharge stamps rows in the same observation; check the order. If the frame can be read before the stamps land, make the stamp mark the frame.
- **Unchanged.** The existing `landed` row printing ([[61267301]]) is left as it is; the client ignores landed rows.

**2. Pathless history = branch log** (`worktrees/CheckoutReads.ts`, `protocol/checkoutHistory.ts`, `protocol/operations/checkouts.ts`, Git kit `packages/git/src/history.ts`)
- **Path optional.** `read_checkout_history` without `path` (and without a cursor that named one) answers the log of HEAD, newest first, paged exactly as the path walk: position on the pinned head, total null. The cursor remembers that it walked no path.
- **Protocol.** `PathHistory.path` becomes `Schema.NullOr(NonEmptyString)` (null = branch log).
- **The graph flag.** `HistoryCommit` gains `graph: Schema.Boolean`: true when the author email is the one the graph committer signs with. That is `gitIdentity('tagma')` in `files/ShadowGit.ts` — `tagma@tagma`; read the identity from there, never a second spelling. `logAt` gains the author email (`%ae`) on `Commit`.
- **Grammar.** Rewrite the operation's grammar and meaning for both readings. Its "not-found" for a missing path goes away.

**3. `read_commit`** (new operation, `worktrees/CheckoutReads.ts`, `protocol/operations/checkouts.ts`, `api/checkouts.ts`, `api/operations.ts`, `http/handlers/checkouts.ts`, `operations/worktrees.ts`)
- **Params.** `{ root?: string, commit: NonEmptyString, thread?: NonEmptyString, limit?, cursor? }`.
- **Answer** (new `protocol/checkoutCommit.ts`): `CommitReading = { rootId, sha, parents, author, date, subject, files: Schema.Array(ComparedPath), added, removed, shown, total, next, complete }`.
  - `files` is the commit's paths, first parent → commit (the empty tree for a root commit), with renames paired and counts.
  - `added` and `removed` weigh the whole set the read covers.
  - `thread` narrows to the paths that thread's change-record rows were stamped with this commit; `total` then counts that narrowed set.
- **Paging.** Default page 100, ceiling from a new page family in `protocol/pageFamilies.ts` measured on its row. Pin the sha in the cursor.
- **Refusals.** `not-found` when the revision names no commit; the checkout place refusals; `git-refused | git-unreadable | git-incomplete`; `bad-cursor`; `cursor-stale`.
- **Route.** `GET /api/checkouts/:rootId/commit`, with query `{ project?, commit, thread?, limit?, cursor? }`.
- **Wiring.** Follow the `read_checkout_history` wiring wherever the catalog needs it: operations table, HTTP handler, native and MCP exposure, answer projection.
- **Git kit.** Put the reading of one commit's files beside `compareAt` in the Git kit.

**4. A commit's patch of one path** (`harness/ThreadFiles.ts#authorshipAt`, `protocol/operations/authorship.ts`, `api/checkouts.ts`)
- **Param.** `read_authorship` and `GET /api/checkouts/:rootId/authorship` gain `commit?: NonEmptyString`.
- **Reading.** Base = the path's blob in the commit's first parent (none for a root commit, or a path the commit added); bytes = its blob in the commit.
- **Answer.** Same shape, every `author` null, `open` runs placed on the parent's side exactly as HEAD's side is today.
- **Cache.** The authorship cache key includes the commit, and a commit reading needs no working-tree probe. A path the commit did not touch answers its identical patch rather than refusing.

## Done when

- The server suites and `pnpm typecheck` (or the repo's typecheck command) pass. New tests pin:
  - the commits frame (listed, rewritten-and-hidden, limit and more);
  - the pathless log with the graph flag and its cursor;
  - `read_commit` with and without `thread`, with paging;
  - the commit patch of one path.
  
  Pin contracts, not prose.
- Claims are written from the code for each of 1–4 under the zones that own those files, and verified. The report names them.
- The three-model review of rule [[6ccec00a]] is done at the builder's rung, and what held is fixed.
- The work is committed with `submit_work` (paths of this task only), and the task is finished naming the commit.
