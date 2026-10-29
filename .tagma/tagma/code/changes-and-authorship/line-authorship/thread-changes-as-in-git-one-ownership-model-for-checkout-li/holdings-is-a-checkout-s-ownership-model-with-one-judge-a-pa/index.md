---
id: 01a1166f-7113-7752-b6b9-0a75fe04fc30
title: "Holdings is a checkout's ownership model with one judge: a path is proven with holders and nobody's, or unproven with a reason"
ord: 4
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/change-record/threadFiles
  - kind: file
    ref: apps/tagma/server/src/change-record/record/heldCounts.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/holding.ts
  - kind: file
    ref: apps/tagma/server/src/platform/rereading.ts
  - kind: file
    ref: apps/tagma/server/src/workspace/checkouts/rows.ts
---
Holdings is the only answer to "what is changed in this checkout and whose is it". One judge builds it, and every surface and operation reads it or a projection of one of its revisions.

## What stands now

- **"Who holds the path" is derived anew in several places,** each with its own cache and subscription:
  - `record/heldCounts.ts` — sidebar: a verdict cache and a "thread → paths" index behind a global `Semaphore(1)`;
  - `threadFiles/listing.ts` — panel: a `kept` cache, a `printed` set;
  - `record/holding.ts` — holders and the checkout line's `writing` on every build of it and in checkout-act answers;
  - `threadFiles/authorship.ts` — its own `AuthorshipCache`.
- **Each reacts to a failure its own way:**
  - the sidebar — "everyone who wrote holds", and a silently unreadable root gives 0;
  - the panel — on the first cycle `files: []`, then a frozen past list with `stale: true`, which the client shows as fresh;
  - the checkout line — holds the past read's holders.
- **Policies diverge:**
  - ignored paths: the sidebar counts, the panel shows, `submit_work` never commits, the discharge retires in the pass that touches them;
  - archived threads: the panel hides, the line marks, the landing excludes (`liveHolders`), the sidebar counts on the index;
  - a thread in `status failed` counts as gone (`record/sessions.ts` `over`), and a neighbor's landing silently carries its lines;
  - the sidebar counts a thread's paths in every root, the panel only in the root where the thread stands.
- `+N/−M` in the panel is the whole file diff (`walk.worker.ts` `weigh` → `threadFiles/patch.ts`).

## Model

One checkout's `Holdings`:
- `checkout`;
- `revision` — a monotonic counter, growing with every changed `Holding`;
- `head` — the HEAD oid the judgement is against;
- `row` — the checkout line's revision whose git status is judged;
- `state`:
  - `current`;
  - `judging{paths}` — shifts accepted, judgement running;
  - `stale{reason}` — git status unread, or the watcher lost; the list meanwhile is the last known;
- `paths: Holding[]`.

**Domain:**
- always — paths under held record lines on this checkout;
- while the status bar, Git tab, or `read_checkout` subscribes to the checkout at this moment — also paths dirty in git status (staged, unstaged, untracked, unmerged), without the graph store.

So nobody paths without record lines are judged only while someone shows them.

**`Holding`:**
- `path`;
- `from` — the old name: from the intake's rename fact (`movedFrom`, [[b17adfeb]]; likewise for an operator move) or staged R;
- `git` — the status letter, `ignored`, or `null` for a path under record lines whose bytes equal HEAD;
- `verdict`:
  - `proven{ hands, nobody }`:
    - `hands: { holder, added, removed, writing, retired }[]` — the holder's lines on [[359519e0]]; `holder` is `{kind: 'thread', thread}` or `{kind: 'operator'}`. The operator is always alive: never `retired`, no runs;
    - `nobody: { added, removed, why }`, where `why` ∈:
      - `external` — an edit outside the record;
      - `steps{commit}` — a commit step's delta never delivered to the working file ([[5fa48d08]]);
      - `unattributed{thread, reason}` — a command shift with no decision ([[b17adfeb]]);
      - `released{thread, reason}` — lines of a withdrawn record line that stayed or returned to disk: thread deleted, checkout deleted, an ignored path archived, an overwritten-and-withdrawn line returned by rollback ([[5fa48d08]]);
  - `unknown{ reason, writers }`, where `reason` ∈ `budget`, `unread{side, cause}`, `worker`, `opaque{side, row, cause}` (row is the blocking line's id or null for a projection), and `writers` are the holders with held lines on the path;
- `lines` — the HEAD→working-file diff `+/−` from the [[359519e0]] alignment, or `unweighed`.

**Totals** are kept incrementally on `Holding` change:
- per checkout: total paths, with holders, of them with the operator (`operator`), nobody-only, unproven;
- per thread on a checkout:
  - `paths` — proven paths where the thread is in `hands`, except ignored;
  - `unproven` — unproven paths where the thread is in `writers`;
  - `outside` — its ignored paths.

## Judge

- **Owner** — change-record. One judge per checkout, single-flight per path instead of a global semaphore. A path a request needs (a landing, an open panel) goes ahead of the background. A landing leases its paths for the "publish → reshape → rejudge" stretch ([[5fa48d08]]).
- **Path input fingerprint:**
  - the held-line key — id, `writing` state, `after` digest, stored-text flags (`holdings/inputs.ts` `rowsKey`). The `after` digest matters because a merged operator line ([[eefb0e60]]) keeps its id: without it the judge would miss the change. For the same reason the folding cache is only good on matching id and `after` digest of every folded line;
  - step-debt and rename facts on the path;
  - the HEAD blob oid;
  - working-file identity — stat, or digest on a ctime under 2 s, as `@runlith/files/working` does;
  - the git status letter and ignored-ness — a `.gitignore` change moves it;
  - the normalization flag.

  The verdict is stored with the fingerprint and rejudged only on its change (I13). `writing` and `retired` marks are annotations on thread records, never walked.
- **Where shifts come from:**
  - intake — record places ([[b17adfeb]]);
  - the checkout line — watcher or mark paths;
  - HEAD shifts — `diff-tree old new` ∩ domain;
  - thread records — a turn started or ended, archive.

  A shift without places (an index shift, a watcher loss) rejudges the domain on fingerprints: only what moved is walked.
- **The walk** is [[359519e0]]. A surface asking for judgement never waits for it: it gets the current revision with `state: judging`, and the judged part arrives as a delta.
- **Lifetime.** A checkout's Holdings lives while the checkout has held lines in a project watched by the thread list, or has a subscriber. With neither, it is gone; on read it builds and releases.
- **Cold start.** First the checkouts of threads visible in the list build, and answers never block meanwhile.
- **Watchers** on checkouts with no subscriber never open: such checkouts' held paths rejudge on intake and HEAD shifts.

**Ports for lower modules.** The checkout line (`workspace/checkouts/rows.ts`) becomes pure git: `holding()` leaves its build. Workspace declares one `CheckoutHoldings` port — holders and `writing` by path — and Holdings fills it. The port serves the current revision and never judges inside the call. It is called by:
- the `read_checkout` answer;
- checkout-act answers (`workspace/checkouts/gitWrites.ts`, the `writing` field);
- worktree archive.

`CheckoutHolders` and `CheckoutWriters` merge into it (2fcf2221).

## Failure is data

- A text read answers one of three: text, proven absence, or "unread" with a reason. "Unread" must never collapse to absence anywhere.
- One path's failure makes only that path `unknown`. A batch (git, worker) failure makes each path of the batch `unknown` with one reason. Other paths are untouched (I5).
- Holdings is empty only in `current`. No output ever turns a failure into zero, emptiness, or "everyone holds" (I4).
- A failure logs once at the owner, with the path and reason. While the reason stays, it never logs again.
- `platform/rereading.ts` drops `reading` on any `settle` outcome — success, failure, defect, interrupt. A defect logs and sets `stale` (I12). This covers the checkout line too.

## Policies

- **An ignored path under record lines** enters the domain with `git: ignored`. It counts into the `outside` total, never into the badge, and never lands. When the thread archives, its lines on such a path withdraw with `outside`, and what stays on disk becomes `released`.
- **A nested repository** is its own checkout when registered. When not, writing into it never becomes a line.
- **An archived thread** is a holder with `retired: true`. Its lines stay its, stay visible, and a landing accepts them.
- **A thread in `status failed`** is a live holder. Archive alone makes a thread gone. This changes behavior: a neighbor's landing in a mixed region gets `lines-held`, where it now silently carries the lines. A test covers it.
- **A deleted thread** is never a holder: its lines withdraw ([[5fa48d08]]), and the on-disk remainder is `released`.
- **rename** is two `Holding`s linked by `from`.
- **A merge conflict (unmerged)** is judged like any path; conflict markers are `external`.
- **A thread in several checkouts:** thread totals sum over all; the panel groups by checkout ([[762eb07f]]).

## Acceptance

- **I1, I2.** Fixture:
  - a path two threads hold;
  - a nobody path with the status bar open;
  - an unproven path (injected unreadable HEAD);
  - an ignored path;
  - an unstaged rename.
- **I3.** Property test: random sequences of two–three threads' edits (tools, commands, external edit, landing, rollback) in canonical and in a worktree. In every revision, the thread's `held.paths` and `held.unproven` match its panel and `read_changes`.
- **I4, I5.**
  - One unreadable path of N: the answer has N paths, one of them `unknown` with a reason.
  - A whole batch text-read failure: N `unknown`s with one reason.
  - git status unread: `stale` with the last list.
- **I12.** A defect thrown into the checkout line's `settle` never blocks its next re-read.
- The checkout line's build never touches change-record.
- A thread in `status failed` holds lines, and a neighbor's landing in its mixed region is `lines-held`.
