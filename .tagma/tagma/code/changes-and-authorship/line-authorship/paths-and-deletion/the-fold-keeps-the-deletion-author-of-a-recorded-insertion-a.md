---
id: 01a16965-a1b3-7a3e-b89c-dd650aea3657
title: The fold keeps the deletion author of a recorded insertion after it appears in HEAD
ord: 7
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/change-record/lines/folding.ts
    symbol: applyStep
  - kind: symbol
    ref: apps/tagma/server/src/change-record/lines/provenance.ts
    symbol: removalsOf
---
The fold keeps the author of a recorded insertion's deletion even after it appears in HEAD.

The projection is computed against the current HEAD, and an unfinished record may still start before the already-landed creation of the file. A deletion with no added lines and no traces of the original base still carries an author: dropping it before retirement would leave the new HEAD's deleted lines nobody's and lose the deletion in the landing's implicit selection.
