---
id: 01a16d25-7008-73ef-94fa-45fd7c039263
title: A HEAD-line deletion shaped by commit steps from live records' lines belongs to them, and a landing carries such a window whole
ord: 9
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/change-record/lines/owed.ts
    symbol: formedLines
  - kind: symbol
    ref: apps/tagma/server/src/change-record/lines/projection.ts
    symbol: projectWork
---
Commit steps format the landing tree, and the disk may hold a line in a form other than its original: a peer already replaced it, or it is the unformed tail of its own author's line. Then HEAD holds a form line that stands in no record, and its absence on disk would look like a nobody's deletion. Landing takes only its own lines and would leave the form line next to the replacement — text nobody wrote; that is how both a peer and the author on the next landing of their own tail committed a duplicate.

The proof of origin is this path's step debt: its windows tell which lines formed the form line. In a window where the line count before and after the form matches, a line's source is the line at the same position; where the form changed the line count (a join, a wrap), every form line's source is the whole window. The Holdings judge passes those pairs to the fold, and a form line's deletion belongs to a live record when that record either deleted every source line (the fold finds its deletion in the same change window) or holds it on disk with its added line in the same change where the form line is deleted, exactly as many times as that text stands among the sources. A text match with extra or foreign occurrences does not count as proof: otherwise a record's insertion would claim a nobody's deletion. A source line that still stands on disk untouched as a base line is the form's remainder, not someone's edit: it belongs to the window. When several live records share a window's source lines, or share them with the remainder, one of them receives the form line's deletion and the remainder, and the window's records are linked by a dependency. The link stands on lines alone, so every record of the window must stay visible in the judge: all but one hold their line on disk in that change, and the one that only deleted receives the deletion; when there is no such record, the latest one does. Two records that only deleted leave the deletion nobody's: one of them would drop out of the judge, and a landing would not name it — not even the operator. A landing by any one of them carries the whole window, naming the rest in `carried`, and the steps form it again: the form line is the joint result of their lines, and it cannot land separately without text nobody wrote. When at least one source line is explained by neither a deletion, nor an on-disk owner, nor an untouched base (a nobody's edit, extra occurrences), the deletion stays nobody's, and the nobody's edit never enters the session's commit. Lines changed outside the steps (an external commit, pull) carry no debt and also stay nobody's. Retirement and rollback folds receive no debts and judge without those pairs.
