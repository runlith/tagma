---
id: 01a0d00c-2ecf-7b08-9009-12944085a12c
title: "A thread's changes and the Git tab become one set of parts that speak git: uncommitted above, the commits that carried them below, one diff pane"
ord: 5
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/CheckoutPage.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/FilesColumn.svelte
  - kind: file
    ref: apps/tagma/server/src/harness/ThreadFiles.ts
  - kind: file
    ref: apps/tagma/server/src/worktrees/CheckoutReads.ts
---
The operator accepted this on 2026-09-23 from the design page http://localhost:5634/a/0a211bd64305 and delegated its two open questions; the answers are under Rejected.

## 1. Outcome

A thread's right-hand panel and the Git tab are drawn from one set of parts — file row, section head, commit row, diff pane, view menu — and say only what git says: modified, new, deleted, renamed, staged, committed.

- **Thread panel.** Head: "Changes", a list/groups switch and the view menu. Section **Uncommitted**: everything the thread changed that no commit carries yet, with its sum in the section head. Section **Commits**, docked below: the commits that carried the thread's changes, newest first. A commit opens into the thread's files in it, a file into the change that commit made. The panel offers no acts. The thread-header button that opens it shows the uncommitted count.
- **Git tab.** The branch row: name; ahead/behind only when not zero; one sync button (Publish, Push or Pull by state). The commit box above the list. Sections Conflicts (first, only when present), Staged, Changes (untracked inside it), Graph as one row with Sync. The branch's log docked below, a run of graph-sync commits folded into one row. The view menu adds Group by thread and Compare with.
- **Rows.** Name first, directory after it, dim and cut from the left. Counts drop a zero side and compress past a thousand ("+9.3k"). Status letter at the right in its colour: M, U (untracked), A, D (name struck), R, C, ! (conflict).
- **Diff pane**, one for both surfaces. A one-line head: short sha when reading a commit, name, directory, counts, other hands, previous/next file, changes/whole file, file history, view menu, close. J and K step files; Esc returns.
- **Tooltips** only on icon-only buttons.
- **Screen width.**
  - Thread: when the main area holds a 480px conversation beside a 640px diff, the diff opens beside the conversation; otherwise it takes the conversation's place, as now. Under 1024px of window the panel overlays the conversation.
  - Git tab: under 900px of window the list and the diff drill down, one at a time, with a way back.

## 2. Problem

- **Server words on screen.** The panel prints server standings: `writing` in its head; `staged`, `refuted`, `observed`, `landed`, `gone` in rows. Its menu has one item, "Show landed, observed and gone (0)".
- **Noisy counts and rows.** `−0` stands on nearly every row, and the head sum is dominated by one generated file (+9309 of +9723 on the operator's screenshot). Rows lead with the directory truncated from the left, and a tooltip hangs on every row.
- **Commits vanish.** A file a commit carried prints once and leaves the list, so what the thread committed is shown nowhere.
- **Two copies of one surface.** The row and the diff head exist twice — the inline row of `FilesColumn.svelte` against `PathRow.svelte`, and `DiffStage.svelte`'s head against `CheckoutPage.svelte`'s — and the two have drifted.
- **Poor Git tab.** It has no branch log. Its commit box sits under the list, and its Amend item is live and dead with nothing staged ([[71444243]]).

## 3. What holds now

- **The thread frame.** `ThreadFiles` (server) streams a thread's paths, each with a standing (`settled | writing | staged | refuted | observed | landed | gone`). A landed path prints once with its commit, then leaves ([[61267301]]).
- **Commit stamps.** Every change-record row a commit carried already holds `commit` and `committedAt`: each HEAD move stamps it with the newest commit touching the path (`files/discharge.ts`). So the commits of a thread are derivable from stored data; nothing reads them out.
- **History.** `read_checkout_history` refuses without a path. `logAt` in the Git kit walks without one and prints the author's name, not the email.
- **Authorship.** `read_authorship` reads HEAD against the working tree only.
- **Existing marks.** The Git tab already has directory groups (`GROUPING`) and the whole-file/changes mark (`DIFF_WIDTH`). The thread panel reaches neither.
- **Graph-sync commits.** The graph's own commits are authored `tagma <tagma@tagma>` (`gitIdentity('tagma')`).

## 4. Target model

- **Client mapping of standings.** `settled | writing | staged | refuted` → Uncommitted. `observed` → one folded row "N files changed by commands": a command moved them, and no typed write proves whose hand did. `landed` and `gone` → not listed: a landed path appears under its commit, and a gone path stands nowhere. The protocol keeps its standings; they stop at the client.
- **Thread commits** ride the thread frame. They are the commits stamped on the thread's rows that are reachable from the root's HEAD, newest first by stamp, cut to the subscriber's limit. A commit that amend or rebase took off the branch is not listed.
- **Commit reads.**
  - One commit's files: first parent to commit; the empty tree for a root commit.
  - The change one commit made to one path: the same patch reader and answer shape as the working diff, from the commit's first parent, naming no authors.
- **Branch log.** A pathless history, each commit flagged `graph` when the server's graph identity authored it.
- **Client parts** in `features/checkout`:
  - `ChangeRow`, replacing `PathRow` and the inline row;
  - a section head, replacing `CheckoutSection`'s;
  - a line count, replacing `PathWeight`/`pathWeight` and printing nothing for `unweighed`;
  - a commit list serving both surfaces;
  - `DiffPane`, replacing `DiffStage` and `CheckoutPage`'s head;
  - one view menu.
- **Unchanged.** The directory grouping stands as the "groups" mode, and the file-history reading (`PathCommits`) stays.

## 5. Owners and boundaries

- **Server, `harness/ThreadFiles.ts`.** Thread commits in the frame. The metadata of a sha is immutable, so it is cached by sha; reachability is cached per HEAD.
- **Server, `worktrees/CheckoutReads.ts`.** The pathless log with its `graph` flag, and the new `read_commit`.
- **Server, `harness/ThreadFiles.ts#authorshipAt`.** The `commit` reading of one path.
- **Git kit.** `logAt` answers the author email; the reading of one commit's files lives beside `compareAt`.
- **App, `features/checkout`.** Every part above. `routes/[project]/chat/+layout.svelte` for the panel toggle and the width rules.
- **App, `packages/chat-ui` `ToolDiff`.** Line wrapping, as a prop.

## 6. Rejected

- **A commit button in the thread panel.** The operator delegated this; the answer is no. It would put two commit acts with different meanings in one product: the thread's held paths against the index. Accepting a thread's work goes through the Git tab: Group by thread, stage that group, commit.
- **A rewritten commit shown dimmed as "not on branch".** It is hidden instead (operator-delegated). The record cannot say which new commit carries those lines, and a dim row promises a commit to open that no longer answers.
- **A separate paged request for thread commits.** The list moves only when HEAD moves, and a HEAD move already re-reads the frame.
- **A nested folder tree.** The directory groups already exist.
- **Hunk stepping with N/P.** The patch reader offers no scroll-to-row; this is out for now.
- **Per-commit "unpushed" marks.** Only an ancestry walk per commit could place them honestly, and the branch row already says how far ahead the branch is.

## 7. Acceptance criteria

- **Thread panel words.** No server standing word reaches the thread panel.
- **Standing mapping.** A path whose standing is `landed` or `gone` is not a row of Uncommitted; `observed` paths sit under the one folded row.
- **Counts.** A row with 0 removed prints `+N` alone; 9309 prints `+9.3k`; `unweighed` prints nothing.
- **Commits.** A commit the thread's change-record rows were stamped with, and HEAD reaches, lists under Commits. Opening it lists the thread's files in it with counts, plus how many other files the commit carries. Opening a file shows that commit's patch of it, and the head names the short sha.
- **Rewritten commits.** After `git commit --amend` of a thread's commit, the old sha no longer lists.
- **Branch log.** `read_checkout_history` without a path answers the branch log newest first, paged. Graph-sync commits are flagged, and the Git tab folds each run into one row.
- **`read_commit`** answers files, counts, total and a cursor, and narrows to one thread's stamped paths when asked.
- **Commit box.** The Git tab's commit box stands above the lists, and Amend is not offered with nothing staged.
- **Tooltips.** No tooltip on a row, a count or a word; icon-only buttons keep theirs.
- **Screen width.** At 1600px wide the thread's diff opens beside the conversation. At 900px the panel overlays and a picked file opens full width with a way back.
- **Tests.** Typecheck and the checkout and server suites pass. Tests pin the mapping, the count format, the commits frame, read_commit and the pathless history — not layout or copy.

## 8. Standing claims and tasks touched

- **Rewritten from the code once built:**
  - [[c7678fe6]] fold becomes the mapping;
  - [[b39ea12e]] sum moves to the section head;
  - [[92041a82]] empty wording;
  - [[063363ce]] letters;
  - [[b8e7c6cd]] `—` becomes nothing;
  - [[f950cb5e]] section order;
  - [[dd5c3278]] graph as one row;
  - [[d9f2858f]] commit box;
  - [[33dd1d3f]] reading note becomes a chip;
  - [[56e35de8]] and [[8efb5239]] acts per section;
  - [[c0f970de]] history face;
  - [[5beb26d3]] arrow walk.
- **Retired:** [[041ceea1]] — the thread panel offers no stage.
- **Kept, re-verified:** [[591d335e]], [[75670881]] (hands), [[1583b2d6]], [[61267301]] (the server still prints landed once; the client ignores it).
- **Task [[71444243]]** is answered by the commit box.
- **New claims** will cover the commits frame, `read_commit`, the pathless log and the commit authorship reading.

## 9. Order of building

1. The server reads, in parallel with the client's shared parts and the quiet pass (mapping, counts, rows, Git tab layout).
2. The client wired to commits on both surfaces.
3. Width rules, wrap and J/K.
4. Three-model review.
5. Claims written from the code; this decision closed into them.

## 10. Contracts

All additive; an old client ignores the new fields.

- **`changes.subscribe`.** The payload gains `commits?: int`. `ThreadFileList` gains `commits: ThreadCommit[]` and `moreCommits: boolean`, with `ThreadCommit = { sha, subject, author, date, files }` (`files`: the thread's stamped paths in that commit).
- **`read_checkout_history`.** `path` becomes optional; without it, the answer is the log of HEAD. `HistoryCommit` gains `graph: boolean`. A cursor remembers whether it walked a path.
- **`read_commit`** (new).
  - Params: `{ root?, commit, thread?, limit?, cursor? }`.
  - Answer: `{ rootId, sha, parents, author, date, subject, files: ComparedPath[], added, removed, shown, total, next, complete }`. `added` and `removed` weigh the whole commit, or the narrowed set when `thread` is given.
  - Refusals: `not-found` (no such commit), the checkout place refusals, the git refusals, `bad-cursor`, `cursor-stale`.
  - Route: `GET /api/checkouts/:rootId/commit`.
- **`read_authorship`** gains `commit?: string`. The answer shape is unchanged, authors are null, and `open` runs are placed on the parent's side.

## 11. Stored data

None. Every read is over existing rows and git objects; nothing migrates.

## 12. Who may do what

Every new read stands behind the same project-coverage gate as `read_checkout`. `thread` narrowing reads that thread's rows inside the caller's project, as the frame already does. No new act exists.

## 13. Long-lived things

- **Caches.** The metadata cache is bounded by entry count (2,000 shas), oldest out first. The reachability cache is keyed by HEAD and dropped when HEAD moves.
- **Subscriptions.** Nothing new outlives a subscription; the frame's state goes when its last holder does.

## 14. Bounded resources

- **Thread commits.** Default 30, ceiling 100. Measured on 2026-09-23 over 829 threads: p50 2, p90 6, p99 30, max 58 commits per thread.
- **`read_commit`.** Default page 100 files, ceiling from a page family measured on its row. Over 3,000 commits: p50 2, p90 25, p99 90, max 12,883 files per commit.
- **Branch log.** Keeps the checkout-history family.

## 15. Rollout

This ships with a server restart and the app built beside it. A page opened before the restart keeps working on the old frame.

## 16. Failures

- **Commit metadata unread.** That commit is left out and the frame is marked `stale`, as a failed reading already is. It is never shown with an empty subject.
- **Reachability undecided.** A commit whose reachability could not be read is kept out.
- **Failed reads.** A refused `read_commit` or commit authorship reading stands where the files or the diff would, in its own words.

## 17. Observability

Each new read runs under its own `Effect.fn` span. The thread panel's Commits section shows a commit landing within one HEAD mark.

## Divergences recorded while building

- **The sync button** was first built Push only; Publish and Pull followed in f001f393e9 and bc1ae4a811 with `checkout_pull`, `checkout_fetch` and the row's `publishTo`, and a Fetch act beside the button so behind can move at all [[0f40eb4c]] [[43b351d0]].
- **Compare with** lives in the menu the branch name opens, not in the view menu.
- **Grouping by folder** is one mark for both surfaces, and it defaults to the flat list. A reader who had chosen folder groups under the earlier mark keeps them.
- **The width rule** holds as written: a 480px conversation beside a 640px diff, so the main area must be 1120px. §7's "at 1600px" example does not hold with both side columns open at their default width: that main area is about 976px, and the diff takes the conversation's place. A 1920px window, or either side column narrowed, puts the diff beside the conversation.
- **The Uncommitted count** includes the files commands changed, because they are rows of that section.
- **The diff head** no longer prints the hunk count. Its line count is read from the reading it draws, not from the list's row.
- **Group by thread** keeps Conflicts first and outside the groups. Unstaged rows in a group offer Discard as well as Stage.
