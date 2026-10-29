---
id: 01a0daf8-90cb-792e-81a2-f963acba8321
title: A thread's file reading reads the record only for the paths the thread wrote, as one set reading per cycle; a path its commands were only seen to move is listed while the checkout names it
ord: 85
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/change-record/contract/service/threadFiles.ts
    symbol: ThreadFiles
  - kind: symbol
    ref: apps/tagma/server/src/change-record/record/evidence.ts
    symbol: evidenceOfPath
---
## 1 Outcome
A thread's file list costs what the thread wrote, not everything its commands ever saw move. A reading of a thread that wrote 20 paths and whose commands were seen to move 600 answers in a fraction of the time, with a handful of statements instead of about 1,900, and the list the surface draws is the same.

## 2 Problem and evidence
`read_performance` overview of the server booted 2026-09-25 23:18:23Z, 23:19:26–23:26:26Z: `WorkspaceChangeLog.evidenceOfPath` 96,623 and `WorkspaceChangeLog.versionTexts` 96,623 (≈ 230 a second, 178 s and 51 s of span time), `sql.execute` 335,733, against 168 `WorkspaceChangeLog.pathsOfThread` — one per reading, so ≈ 575 paths weighed per reading. Stalls of 100–700 ms in the same window sit in drizzle's query building (`is3`, `bindIfParam`, `buildSelectQuery`) and in parsing the SQLite child's answers (`connection.ts receive` → `parse`), the per-path statements' own cost on the loop.

The store (read-only): thread 01a0d552, open in a tab, holds 22 typed paths and 635 paths it only observed; observations are never retired, so every reading of it weighs 657 paths. A rig (a seeded store, a checkout of 620 committed files, 600 observed clean and 20 edited by the thread, `ThreadFiles.read`, spans counted): 1.2–2.4 s and 1,874 SQL statements per reading, 620 `evidenceOfPath` and 620 `versionTexts`.

## 3 What holds now
- `ThreadFiles.reading` weighs every path `pathsOfThread` names — typed rows and every observation ever recorded — reading `evidenceOfPath` (the typed rows with both texts, the observations, then `versionTexts` for every digest) once per path, then `weighPath`.
- `standingOf` answers `observed` for a path the thread only observed before it looks at the weight: the record read and the weighing are thrown away for those paths.
- The surface folds apart observed paths only while the checkout names them (`status !== null`, claim c7678fe6); an observed path the checkout does not name reaches no reader.
- A reading runs on every mark of the checkout and every stamp of the thread's rows, for every thread a surface holds open.

## 4 Target model
- An observed-only path is listed while the checkout names it, with its status, line counts and holders, and takes no record reading. One the checkout does not name is not listed.
- The typed paths' evidence is read once per reading, as one set reading over all of them in groups: the typed rows and the observations of a group in one statement each, and the texts of every digest the rows name in one statement per group. A row reaches the paths it matches by the same rule `samePlace` states — the address, the root and spelling, or the spelling where the row proved neither. `evidenceOfPath` is that reading over one place.
- A group bounds how many paths one answer carries, because the answer crosses from the SQLite child and is parsed on the loop in one piece; 64 paths keep one answer to a few MB at the record's own measured 71 KB of texts per held path (the largest holder, 1,268 paths, 90 MB).

## 5 Owners and boundaries
`apps/tagma/server/src/harness/ThreadFiles.ts` (`reading`, `weigh`) and `apps/tagma/server/src/harness/WorkspaceChangeLog.ts` (`evidenceOfPlaces`, `evidenceOfPath`, `versionTexts`). The landing (`submitWork.ts`) still reads per path; it can take the set reading as its own change. Retiring observations is out of scope: they are a record the change reads answer.

## 6 Rejected
- Keeping each path's weight between readings keyed on its inputs: a cache, forbidden, and the observed paths never needed a weight.
- Retiring observations after a commit or an age: changes what `read_changes` answers, and the list need not read them to be right.
- One statement for every path at once: one answer of the largest holder would be ~100 MB parsed on the loop.

## 7 Acceptance
- `ThreadFiles.itest.ts`: an observed path the checkout names reads `observed` with its status; one the checkout no longer names is not listed; the existing readings hold (writing, settled, shared, staged, refuted, landed, gone).
- `WorkspaceChangeLog` set reading: for several places at once — rows placed by address, by root and spelling, and unproven by spelling — each place answers what `evidenceOfPath` answers for it alone.
- The rig of §2: statements per reading from 1,874 to under 20, `evidenceOfPath` and `versionTexts` per reading from 620 to at most a group's worth, and the reading's time falls.
- Deployed: `WorkspaceChangeLog.evidenceOfPath` and `sql.execute` in the `read_performance` overview under comparable load.

## 8 Claims and tasks
- A new claim under this area: the reading reads the record only for paths the thread wrote, in one set reading per cycle; an observed-only path is listed while the checkout names it.
- A new claim on `evidenceOfPlaces`: a row reaches every place it matches by the one placing rule, in groups bounded for the answer's size.
- c7678fe6 (the surface) stays true. 67c2f475 (HEAD texts batched) stays true.

## 9 Order
The rig's before-reading (taken), the set reading with its test, then the reading's change with its tests, then the rig after.

## 10–17
- 10 Contract: `ThreadFileList.files` no longer carries an observed path the checkout does not name; its schema is unchanged and no reader drew those rows.
- 11 Stored data: out — nothing written or migrated.
- 12 Who may do what: out.
- 13 Long-lived things: the reading's state and its marks are unchanged.
- 14 Bounded resources: statements per reading, the bytes one answer carries (a group of 64 paths), and the loop time parsing them.
- 15 Rollout: needs a deployment; an open subscription receives the smaller list at its next reading.
- 16 Failures: a store failure fails the reading as before (the frame goes stale); a failure in one group fails the reading rather than listing some paths without their record.
- 17 Observability: the new `WorkspaceChangeLog.evidenceOfPlaces` span beside `evidenceOfPath`, and `sql.execute` counts in the overview.

## Divergences found while building
- §4 as built: the set reading is `evidenceInGroups`, which hands each group of 64 paths to its caller and lets it go before the next group is read, so a reading never holds more than one group's texts; `ThreadFiles.reading` weighs a group's paths inside that callback. A reading that kept every group's answer until it ended would have held the largest holder's whole record (≈ 90 MB) at once. The group's span keeps the name `WorkspaceChangeLog.evidenceOfPlaces`. `versionTexts` splits its digests by the statement's bind limit.
- §7 rig after: 17 statements and 0.55–0.9 s per reading, against 1,874 statements and 1.2–2.4 s.
