---
id: 01a0c71b-994a-7031-9243-634807f4d074
title: Writing one function's signature clipped a neighbouring comment mid-sentence, and the repair could only delete it whole
ord: 7
tags: ["reflection"]
fields:
  {
    "actual": "The two-line comment standing on `historyForUpdate` — \"History under the write lock: the caller's unit ALREADY holds the database's single write permit, so nothing moves the history until it commits.\" — was clipped mid-sentence, leaving a dangling half that said nothing. The writer's only repair was to remove what was left, so the function now carries no comment at all. The door's answer each time was \"Dropped N prose comment lines … a why lives in a doc on path#Symbol\".",
    "command": "edit on apps/tagma/server/src/thread/ThreadStore.ts, adding a `reads?: ThreadRolloutReads` constructor parameter and passing it to `new ThreadEntryFold(db, reads)`",
    "expected": "The edit touches the constructor. Prose the project's comment law does not allow is answered as a refusal or removed as a whole comment, and a comment on another function two hundred lines away is either left standing or taken entirely — never cut in half."
  }
---
Filed from project `runlith`.

The removal itself is this project's own law working as intended: prose belongs in the graph, on the symbol, and that sentence is now written there instead. What is not intended is the shape of the removal — a half-sentence left in the file, on a function the edit never named, so the writer had to notice the damage and decide what to do about somebody else's text. A writer who did not read the whole diff would have committed a comment cut in two.

Two facts that make it worth a record rather than a shrug. The clipped sentence was CORRECT and load-bearing: it was the argument for why that one face needs no rested branch — exactly the "why" a later change has to reconstruct, and the reason I had asked for it to be written down in the first place. And the same door refused three further attempts to write that argument back beside the code, which is the law, but between the two behaviours the net effect of one unrelated edit was that a true sentence left the repository and nothing was put in its place until a human noticed.

Measured cost: four write attempts spent, one existing comment lost, and the recovery was a person reading `git diff` and copying the sentence into the graph by hand. The evidence stands in the working tree of apps/tagma/server/src/thread/ThreadStore.ts as of 2026-09-22.