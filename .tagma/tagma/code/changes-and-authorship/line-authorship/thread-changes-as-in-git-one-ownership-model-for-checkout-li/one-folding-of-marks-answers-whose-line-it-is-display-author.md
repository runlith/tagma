---
id: 01a1166f-7113-7752-b6b9-0a74359519e0
title: "One folding of marks answers whose line it is: display, authorship, landing, rollback, and line exit are its projections"
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/change-record/lines
---
"Whose line is this" is one question, and one folding answers it. Everything that currently answers that question its own way becomes its projection.

## What stands now

Six algorithms, each with its own edges: someone else's overwritten line, a deleted file, CRLF, an emptied file, a chain break from an external edit.
- **Myers marks** — `lines/frontier.ts` `walk`/`holdersOf` (sidebar).
  - 3–4 full Myers passes over the whole file per record line (`alignMarks` ×2, `alignDeletions` ×2) plus loading every version of every path line.
  - O(R·Myers(N)) work per path, O(R·size) memory.
- **Text replay by windows** (`windowMatches`) — `lines/attribution.ts`:
  - `weighPath` — panel state;
  - `landingOf` — landing: when no other live holder stands on the path, the file lands whole.
- **`carriedLines`/`writtenLines`** (`lines/replay.ts`) — `read_authorship` and violation-line attribution (`prepared/subject.ts`). A line two records claim, `authorOf` calls nobody's.
- **`revertOf`** (`lines/revert.ts`) — line rollback and `read_rewind`.
- **`dischargedIds` heuristics** (`record/discharge.ts`) — line exit.
- **"A line exists, so it holds"** — `record/holding.ts`, `record/evidence.ts` `writersOfPlaces`.

## The folding

One function in change-record (`lines/`) instead of `frontier.ts`, `attribution.ts`, `replay.ts`, and `revert.ts`.

**Inputs:**
- the path's record lines in order: `before`/`after` digests, their texts (when stored), hunk;
- the folding base text — the version the first held line applied to, or HEAD at its start;
- the working bytes;
- the line-ending normalization flag (`lines/ends.ts`, `389d6935`);
- the work budget (`stepsIn`).

**Path state:**
- the front digest;
- the front lines' run-length marks — each line either a base anchor (its number in the base) or the id of the record line that introduced it;
- records of deleted: which line (an anchor or someone else's) each record line deleted, and where.

**Folding step.**
- A record line whose `before` equals the front applies with its hunk in O(log runs + hunk). Marks live in a persistent run-length tree; the position comes from the hunk's exact span, which intake writes ([[b17adfeb]]). Lines without a span (pre-migration) get one from the worker: exact positions and bounded window alignment. Both paths apply identically.
- A line whose `before` does not equal the front is a break: something outside the record changed the file. The front aligns with its `before` through Myers, only between the diverged neighboring anchors. Unexplained lines get the `external` mark.
- At the end the front aligns with the working bytes the same way.

**Return to a known version.**
- A record line whose `after` digest-matches an earlier front version in the held chain restores that version's marks and holds nothing new itself. So `stash` → `pop`, `git checkout` back and forth, and a manual undo with an exact text match return ownership. Version snapshots are cheap in the persistent tree; only versions inside the chain are kept.
- A line with `reverts` ([[b17adfeb]]) applies the reverse deletions of the cancelled lines — a partial turn rollback.
- Both rules derive from durable facts and survive a cold recompute.

**A textless line whose `after` equals the working bytes' digest** takes the working bytes as its text (`holdings/inputs.ts` `afterOf`). So operator-created and operator-moved directories ([[588b85a5]]) weigh line by line without storing hundreds of files' texts. On digest mismatch `after` stays opaque — a normal break, `external` on the diverged window. A textless deletion is never opaque: its `before` is the front.

**An opaque record line** — no texts and no placeable hunk; for example, a command line with no bytes when the file moved before the count (`commandRows.ts` `WHOLE`).
- Its effect is recovered from its neighbors: between the previous line's `after` and the next line's `before` text, when the neighbors' texts are known.
- Otherwise the path is `unknown(opaque)` until file-level proof ([[5fa48d08]]). The reason names the side, the blocking line's id when known, and the lost text or mismatched line window; a projection error is never charged to an arbitrary record. This reaches `read_changes` and the path's UI explanation.

**A clean diff derives from the folding, not from a separate Myers.**
- Base anchors are matching hints, not hard bounds. A deletion and an insertion of the same line cancel out.
- When cancelled lines stand on different sides of an anchor, the affected windows merge, the crossed anchors lift, and a cancelling LCS with a work budget runs in the merged window. Example: base `[a,b,a]`, A makes `[a,c,b]`, B makes `[b,a,c]`; a hard anchor on the first `a` would give +2/−2 instead of the minimal +1/−1.
- The count must match the minimal HEAD→working-file diff. When the budget runs out, the path becomes `unknown(budget)` instead of getting a non-minimal diff.
- Of equal-length LCS candidates, the one keeping more source anchors wins. When minimality still requires lifting an anchor, its mark goes to the last move writer crossing it. Example: base `[a,b,c]`, A made `[a,c,b]`, B made `[c,a,b]`. Line `c` leaves as `+c/−c`, and B holds it. Recording it as `base` or `external` would be a lie: the whole chain is explained by records.
- At `bytes == base` the diff is empty.
- A HEAD shift is one "old base → new HEAD" alignment per path. It caches on the oid pair, and anchors translate through it. The folding never recomputes on it.
- `Holding.lines` comes from the same alignment, so I2 holds by construction.

**A change region** is one continuous clean-diff segment between two anchors. It is the unit of landing separability.

**Result:**
- `lines` — for every added and deleted line of the clean diff, a mark: thread or `external`;
- `regions` — change regions with their marks;
- `standing` — which record lines still have at least one line in the clean diff;
- `overwritten` — which record lines have every line replaced by another record line, and by whom;
- `verdict` — `proven` or `unknown(reason)`: budget, unreadable side, opaque line.

`external` is proven "nobody from the record", never "don't know". `unknown` only ever covers a whole path.

**A file judged whole** (binary or past the text limit): no lines. The thread whose last record line has `after` equal to the bytes' digest holds it. Otherwise — `external`. `lines` is `unweighed`.

**A deleted file** is held by the thread whose last record line is `delete`, while HEAD still carries the file. An emptied file (`''`) differs from a missing one (`null`) in digest, folding, and diff.

## Projections

- **Display and authorship** (Holdings `hands`, panel, `read_authorship`): a line is held by whoever recorded it last — thread or operator ([[eefb0e60]]); the folding mark is the holder key (thread uuid or `operator`). A line carries one mark, so the old "two claimed it, so it is nobody's" is gone.
- **Landing** (`submit_work`, `check_rules over: change`, the pre-landing rule judgement). The commit version is assembled by regions:
  - a region of carriers only — lands;
  - a region where carrier lines stand next to lines of a live holder of another session — thread or operator — refuses with `lines-held` naming names (`operator` for the operator). The typical case is another session’s uncommitted function fragment's torn fragment: A added a function, B edits a line inside it;
  - a carrier region with an archived thread — the archived lines ride along and are accepted, as now;
  - a carrier region with nobody's lines — the nobody's lines ride, the answer names them in `carried`;
  - a region with no carrier lines stays on disk;
  - with no other held threads on the path, the file's nobody lines ride the whole landing, named. This is how `landingOf` behaves now, and it stays.
  - `whole` carries the whole working file and names what it carries. `unknown` without `whole` is a `walk-cut` refusal with the path.
  - The `staged-elsewhere` check stays a landing index check.
- **Violation attribution** (`prepared/subject.ts`, enforcement) — marks on the commit tree's lines, carried through the step delta (`stepHunks`), as now.
- **Turn rollback** (`revert_lines`, `read_rewind`). Lines that added the selected turns' lines are deleted. Lines they deleted or overwrote return with their source marks — from the folding's deletion records. When B rolls back its own edit of A's line, the line is A's again.
- **Line exit** ([[5fa48d08]]) — `standing`, `overwritten`, and HEAD alignment.

## Where it lives and runs

- **Folding state** is small: digest, run-length marks, anchors, deletion records. It lives in the server process, in an LRU bounded by the machine budget ([[f16c4571]]). Killing the worker on its wall fails (`lines/walks.ts`) never wipes it.
- **On the loop** — steps bounded by the hunk size.
- **In the walk worker** (lanes `now`/`later`) — break Myers and base alignments. Only these texts' windows go to the worker, never the whole path.
- **A cold fold** is needed at startup or after LRU eviction. Versions read from storage only for lines past the cached front.

## Implementation contracts

Refined after review e6206aec27.

- **Minimal diff without the square.**
  - First the diff runs with hard anchors. Then minimality is checked with an O(N·D) Myers count of HEAD→working.
  - Anchors relax only on mismatch, and only in spans with more pair candidates than anchors between them. Otherwise repeated `}`, empty lines, and `)` would glue everything between distant edits into one window.
- **Projection by runs.**
  - Gaps and positions build on runs: a base run translates to a HEAD interval. The cost is O(runs·log + diff), not O(N + history) per call.
  - Rollback finds the source position by descending the rope.
- **Deletion on partial replacement.** A deletion inherits only when the whole source is deleted. B deleting part of A's uncommitted lines gets those lines' deletion, not A's base line.
- **Moves.** When minimality lifts an anchor, its mark goes to the last non-base source among the pairs crossing that anchor in the window's own LCS. `external` is set only when no such pairs exist.
- **Hunk** is the intake `LineHunk` ([[b17adfeb]]), with no second type.
  - The hunk window reconciles against the front.
  - When the window mismatches but the `after` text is known, a text step runs. A `reverts` line whose result mismatched `after` runs the same way.
- **Cache and `unknown`.**
  - Nothing caches on `unknown`.
  - State stores the last folded record line's id. On an id-sequence break in the chain the folding refuses instead of calling the gap `external`.
  - Base alignments cache on the blob-oid pair and the normalization flag, and the projection reconciles them.
- **Rebasing.** When record lines leave held ([[5fa48d08]]) or the base moves, the folding rebases: departed lines are cut with their snapshots and edits. When state does not fit in memory, that shows in the log instead of happening silently.
- **Binary** is decided by the reader: the file arrives as judged-whole. The folding never decides it (51c66cb6).

## Acceptance

**Folding unit contracts** (pure code, no process or disk):
- base `[a, }, b]`, carrier inserts `[x, }]` after `a` and is the only writer — the diff's `x` and second `}` carry the carrier's mark, landing yields the whole working file `[a, x, }, }, b]`;
- thread B edits a line in thread A's uncommitted function: display shows B's line; B's landing is `lines-held` with A;
- a split replacement `L→L'→L''`: landing B yields `L''`, A is `overwritten`; after B's rollback A holds `−L/+L'` again;
- B rolls back its own edit of A's line — the line is A's again;
- deleting a file after someone else's edit;
- a CRLF file with an LF edit under `text=auto`;
- `''` versus missing;
- an external edit between two record lines — `external` only on the diverged window;
- a base shift with no new line — the folding never recomputes, anchors translate;
- an opaque line with known neighbors — placed;
- an exhausted budget — `unknown(budget)`;
- binary by digest.

**Integration on the same inputs:**
- a line `read_authorship` attributes to a thread enters its `added` in Holdings and its landing, when its region is separable;
- a line the landing left on disk is never counted on the carrier.

**I2** holds on every proven test.
