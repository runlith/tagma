---
id: 01a13fab-eeb5-7b45-9ad8-312da2c44f94
title: A conversion debt repeats the whole blob delta, so inserting a new block never detaches from deleting the old one
ord: 6
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a13f63-559c-7cb3-89b6-c446472a019b
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/lines/owed.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/retire/debts.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/retire/driver.ts
---
A conversion debt repeats the whole blob delta, so an inserted new block never detaches from the deleted old one.

After a conflicting reshape, the step or post-commit debt keeps the source blobs; retirement replays their three-way merge with the working file and publishes through CAS. The conflict keeps the whole debt and the working bytes: independently applying text windows could insert the shaped block while a peer still held its old tail, then falsely close the debt on a found fragment. Windows stay projections of owed lines, never write units; a clean file after a later landing clears the old step debt.

If a step-debt merge conflicts but the path in HEAD is no longer the debt commit's, both debt sides first move onto HEAD: the conflicted piece keeps HEAD's text. So a peer landing whose lines already held the shape on disk clears the conflict: its lines are already in HEAD in their own steps' shape, and the debt only appends the remainder — e.g. the author's tail the steps removed in the commit. A moved result counts only if no more of the debt's source lines (pre-shape lines gone after) remain in it than in HEAD itself: git merge-file's chunk also grabs neighboring lines, and picking HEAD in it could clear the debt while the unshaped tail still stands. Then the debt waits for the path's next landing. That is by design for an author's tail next to a peer's line: the tail is the author's uncommitted line, its receipt's `left` and the Holdings court name it, and the author's next landing carries it through the steps and writes the shape to disk; appending the shape in retirement over a partial piece would mean guessing the boundary git merge-file never gives. While the peer's lines are unlanded, HEAD at that place matches the debt commit, and the conflict holds the debt as before. A post-commit debt never moves this way: the first later commit on the path clears it.
