---
id: 01a168eb-6e71-735c-85cb-71c65fead709
title: A session-typed field lies in the block file as harness:key and in the mirror as its copy's session number
ord: 11
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a13b49-8b56-7bb2-a992-457638898737
  - kind: relates
    to: 01a1369b-24c0-7f0a-ac26-731c9cd335df
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/steps/holdersProven.ts
  - kind: file
    ref: apps/tagma/server/src/graph/steps/sessionNamespace.ts
  - kind: file
    ref: apps/tagma/server/src/graph/tree/sessions.ts
---
Every graph copy — main checkout, worktree, colleague's clone — has its own mirror with its own sessions table, where the session number is a local autoincrement. So a number in a file meant a different session in a different copy: a worktree cut from main saw main's foreign task behind its own session, and `submit_work` appended its name to worktree commits. So the file carries a `session`-typed field as `harness:key`, and the mirror row the number of its own copy; the tree translates at its own boundary, as with a block uuid and its local id. Storing the token in the row was rejected: it would change every holder consumer — the journal, `holdersOf`, holder selections, app badges, and the `query_blocks` wire. A native thread keeps one writer identity across a harness-namespace rename: the opening step merges duplicate writer rows and translates graph references before projection, while session tokens accept either namespace and write the current one.

The token is written out by `connectionRows`, with the same text rendering as edges and sources, so the full projection, the act projection, and the ledger write identical bytes. Reading (`readSessions` in rebuild and repair) finds or starts the session in the copy's registry. Moving a block to another graph (`relocate`) translates such fields the same way: it recognizes the session by the source registry and takes its number in the target registry. A number in a file is the old form. It reads as this copy's session only if the mirror already held the same number for the field; otherwise it is another copy's number, unverifiable here, and the mirror holds it as the `elsewhere:<number>` session while the projection writes it back as the same number. So a copy that does not know the number never touches its row, and merging with a copy that translated it into a token goes clean; a dropped number would delete a row another branch rewrites. A rebuild, as before, keeps the mirror's holder when the file does not name it.

Rows poisoned before the translation are cleaned by the `20261023130000_holders_proven` step: the holder stays the copy's session only if this block's last `claim` event in the copy's journal was recorded by the same session; otherwise it becomes the `elsewhere` session of the same number. Only the copy in whose journal the number was born can prove it, so the step cannot produce an identical file in all copies: each branch translates its own numbers and never changes others', and branch merges never conflict on the holder row.
