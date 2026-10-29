---
id: 01a16170-0fb0-703b-baf9-562549ee4d3d
title: Ending or replacing a debt owner reports remaining entries but does not hand them over
ord: 10
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/rules/ending.ts
  - kind: file
    ref: apps/tagma/server/src/graph/contract/service/workDebt.ts
  - kind: file
    ref: apps/tagma/server/src/graph/operations/answers.ts
  - kind: file
    ref: apps/tagma/server/src/graph/voice/answers.ts
---
`close_block`, `finish_block`, and `supersede_block` answers for a task or spec name the remaining debt under every active enforced rule and point to `enforce_rule` with `owners`: ending the work does not mean the violation is gone and does not pick a new owner. Without a `commit`, the source is the stored enforcement document. With a `commit`, the `finish_block` answer checks this owner's debt on the named commit's tree with the same standing-debt computation as the background remeasure: renames, holds until landing, and violation counts share one owner. The answer does not wait for the background queue, does not look for escape origins, and does not touch the ledger; file-local and program checks with known sources get the debt paths and the changes since the previous measurement. An unreadable document or an unavailable check is reported separately and does not block ending.
