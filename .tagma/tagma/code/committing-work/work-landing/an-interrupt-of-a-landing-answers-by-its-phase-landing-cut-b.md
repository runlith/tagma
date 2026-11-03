---
id: 01a1a37f-eebe-7b37-b385-30b6b2100315
title: "An interrupt of a landing answers by its phase: landing-cut before the publication witness, the publication read back after it"
ord: 208
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/landing/land/submit.ts
    symbol: submitWork
---
An interrupt can reach a landing from any step, and a caller left with a raw interrupt has to read git to learn whether a commit landed. So `submitWork` owns the mapping once, not each step. It remembers the last step the landing named through `CallStage`, and whether the publication witness was written, which happens just before `update-ref`. An interrupt-only cause before the witness proves nothing was published, and refuses `landing-cut` naming that step. After the witness, the commit is read back from the ref and its reflog, as `settleSubmission` reads it after a restart. A commit the ref reached answers the witnessed receipt. A commit whose arrival cannot be told refuses `root-unproven`, because claiming either outcome would be unproven. An interrupt of the calling fiber itself still ends the call: no value can leave an interrupted fiber, and the settle hook answers that call.