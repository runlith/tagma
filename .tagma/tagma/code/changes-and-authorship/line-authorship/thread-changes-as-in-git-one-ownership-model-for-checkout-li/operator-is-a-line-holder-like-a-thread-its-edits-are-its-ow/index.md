---
id: 01a117dd-98e5-7df2-86cb-e3f9eefb0e60
title: "Operator is a line holder like a thread: its edits are its own lines, never ride an agent commit, and leave with its own commit"
ord: 10
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/contract/wire/holdings.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/intake.ts
  - kind: file
    ref: apps/tagma/server/src/workspace/contract/wire/checkout.ts
---
Operator edits from the Tagma editor ([[3b5e7d6f]]) are the operator's own lines. They show as "You" everywhere holders show, never ride an agent's commit, and leave with the operator's own commit.

## What stands now

- The server already has the operator identity: `platform/contract/wire/actor.ts` `Actor` = `operator | thread | session`, `OPERATOR_PRINCIPAL`; operations can be `callers: 'operator'`.
- Line accounting is keyed on the thread: `Intake.land(work: {projectId, threadId}, …)` (`change-record/record/intake.ts`), `workspace_change.threadId` is required, `Hand {thread, …}` (`change-record/contract/wire/holdings.ts`), `CheckoutHolder {threadId, …}` (`workspace/contract/wire/checkout.ts`).
- An edit past the tool doors is nobody's (`external`), and nobody lines under [[359519e0]] ride an agent's landing: a carrier region with nobody lines lands, and on a path with no other held threads the file's nobody lines ride whole.

## Goal

- **Holder** = `{kind: 'thread', thread} | {kind: 'operator'}`. The `Holder` type is declared in its lowest consumer — `workspace/contract/wire/checkout.ts` (taken by `CheckoutHolder`); change-record, landing, and the client import it from there (144dfedc).
- The `workspace_change.threadId` column becomes `holder` in one drizzle migration: a thread is its uuid, the operator is `OPERATOR_PRINCIPAL`. `IntakeWork` becomes `{projectId, holder}`.
- The operator is always alive: never `retired`, never deleted, with no runs or turns; `read_changes {agent}`, `revert_lines`, and `read_rewind` never touch the operator. The mark is "You" in UI, `operator` in agent answers.
- **Operator intake** — a new `tagma/change-record/Intake` service tag (`contract/service/intake.ts`) with `turn` and `land` members, the same path as tools: a queue at the place, intent, CAS, confirmation, startup resolution. `checkout-files` calls it ([[588b85a5]]).
- **Merge.** Autosave writes once a second, and every record line keeps full before and after texts: 10 minutes of editing a 60 KB file is 100–200 versions before commit. So an operator record W confirms by merging into a record R when R is the operator's held line on the same path, `R.after = W.before`, and no other holder's line stands on the path after R. "Fact before file" order holds: the W intent, the CAS write, then in one unit — `R.after = W.after`, R's hunk recomputed (large texts in a worker, 7a910861), W deleted, the intermediate version freed. A restart between write and merge decides W the ordinary way.
- **Visible:** `hands` in Holdings contains the operator; the Git tab groups "Your changes" ("Group by thread" becomes "by holder"); the thread panel names "You" among holders; the status bar is "N changes · M yours · K nobody's · L unverified"; `read_authorship` paints operator lines with their own mark.
- **How the operator commits:** Git tab, stage → `commit_checkout`; the exit driver runs the exit on I7 [[5fa48d08]] — a commit carrying its lines is `committed {C}`. An agent acts on the operator's word with `submit_work taking: ['operator']`. `whole` carries operator lines and names them in `carried`.
- **An agent landing** touching a region with operator lines is `lines-held` naming "operator", and `unblock` offers asking the operator to commit or landing with `taking: ['operator']` on the operator's word. An operator-only region stays on disk.

## Neighboring spec edits (enter their text at build)

- [[359519e0]]: a textless record line whose `after` equals the working bytes' digest takes the working bytes as its text. Then operator-created and operator-moved directories ([[588b85a5]]) weigh line by line without storing hundreds of files' texts; on digest mismatch — a normal break, `external` on the diverged window. A textless deletion is never opaque anyway: its `before` is the front.
- [[fe04fc30]]: the path fingerprint at the judge includes held lines' `after` digests — a merged line keeps its id, and without the digest the judge would miss the change. `Holding.from` for an operator move comes from the intake's `movedFrom` fact.
- [[b17adfeb]]: operator record merge; intake takes the operator holder.
- [[762eb07f]]: "You" in panels and the status bar, `CheckoutTotals.operator`, `submit_work`, `read_checkout`, `read_authorship` texts.

## Deleted

`workspace_change.threadId` (→ `holder`), `IntakeWork.threadId`, `Hand.thread`, `CheckoutHolder.threadId`, `AuthoredLine.author: NamedThread` — all replaced by the holder.

## Acceptance

- An operator record — Holdings names the holder "operator".
- An agent landing in a mixed region — `lines-held` with the operator; in an operator-only region the operator's lines stay on disk.
- The operator's `commit_checkout` — its lines are `committed {C}`.
- 30 operator records in a row — one record line and one held version over base; the merged line is rejudged.
- A textless creation with `after` = working bytes weighs line by line.

Outside this spec: edits from the operator's own terminal stay nobody's — its command windows never become "operator" holders.
