---
id: 01a118ce-4103-7011-99e0-a49a381e2ceb
title: An operator move and delete write one fact pair per committable file, in one land and without texts
ord: 6
tags: ["explanation"]
sources:
  - kind: dir
    ref: apps/tagma/server/src/checkout-files/entries
---
The operator's move and delete write one fact pair per file git can commit, in one land and without texts.

The makeup is `filesUnder --others --exclude-standard` over the act's roots: ignored files yield no facts, a directory moves with one `rename(2)`. The first list exists to know which queues to take; under the queues the list is taken again, and digests count there. If new files appeared, the move repeats up to three times, then refuses `source-moved`. Facts are `delete {before}` and `write {before: empty, after, movedFrom}` (restore is only `write`), the worker counts digests in batches; texts are never stored, because a line without texts whose `after` equals the working bytes takes them as its text (359519e0). Every fact goes into one `Intake.land`: `movedFrom` resolves only inside one land, and `Holding.from` derives from it.

Intake takes one `Intake.turn` call over every touched path, like the agent tools. Path merging by place and capture order are its business: merging here again would repeat it with a different answer.

- A leftover race, as with CAS: a file that appeared inside the directory after the second list (its queue never taken), or a write past intake between the digest and the rename, moves with no fact or with the old digest.
- Every pair is checked before the first move. A target inside another target or source refuses. A refusal mid-way rolls back what already moved; the refusal names what could not be brought back.
- A process fall does not roll back, but each pair is one `rename(2)`, and `settleIntents` at startup confirms or removes intents by disk state: facts converge with what stands.
