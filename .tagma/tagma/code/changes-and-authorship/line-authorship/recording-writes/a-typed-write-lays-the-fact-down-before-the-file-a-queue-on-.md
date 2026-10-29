---
id: 01a116e8-e332-7693-815b-e09acb607989
title: "A typed write lays the fact down before the file: a queue on the path, an intent, a CAS write, confirmation; the unconfirmed is settled by startup"
ord: 1
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a11681-3d09-70d2-97f5-12dd417d8235
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/record/intake.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/intents.ts
  - kind: file
    ref: packages/agent-tools/src/changed.ts
  - kind: file
    ref: packages/agent-tools/src/WorkspaceChanges.ts
  - kind: symbol
    ref: apps/tagma/server/src/change-record/record/intents.ts
    symbol: standingAt
  - kind: symbol
    ref: apps/tagma/server/src/workspace/checkouts/paths.ts
    symbol: spelled
---
A typed write lays the fact down before the file: a queue on the path, an intent, a CAS write, confirmation; startup settles the unconfirmed.

A record line is the fact "a holder — a thread or the operator — moved a file from version to version", and Holdings believes only it. If the file is written but the fact is lost, the lines go to nobody or to a parallel command. So a typed write runs in this order:

1. **The queue** on `(checkout, path)` — from reading the file to answering (`Intake.turn`, the `WorkspaceChanges.turn` port). Every typed writer takes it: `edit`, `write`, `delete`, `rename` (both sides), `import_output`, `strip_comments`, `save_agent`, record rollback, and the operator's writes from `checkout-files` — through the `Intake` service tag (`contract/service/intake.ts`) with the `{kind: 'operator'}` holder. Without it, a second parallel write reads the same bytes and misses CAS. The place the queue found is taken by `land` from it, never looked up twice.

   An act over several paths takes the queues with one call over the whole set: `Intake.turn` merges paths by place and takes one queue per place, in place-key order. Two spellings of one place (a directory through a symlink) would otherwise take one queue twice and wait for itself until the tool's hold ceiling, and capturing in spelling order instead of place order would deadlock opposite acts.
2. **The intent** — a `writing` line with the versions' digests and texts, in one unit for the whole change list. The `Lives.instant` mark registers before the file writes, so no command picks this shift up for itself.
3. **Writing the file through CAS** (`changed.ts` `replaced`): new bytes to a temporary file next door, a recheck that the read bytes still stand, an atomic rename over with the same mode; a write through a symlink changes its target, a create is exclusive. The leftover race with a foreign writer is microseconds between the check and the rename, and then the command picks the shift up. A miss removes the intent along with its mark, and the tool answers "the file changed, read it again". A store failure before the write is a refusal; the file untouched.
4. **Confirmation** — `writing → held` with one UPDATE on the mode.

Steps 2–4 never break inside `Intake.land`: a stopped call finishes confirming bytes that already landed. If confirmation never landed, the tool says so — the file is written, the line awaits startup (`Landed` `unconfirmed`). Startup (`settleIntents`) confirms the line if disk equals `after` (for a delete: no file), removes it if not. Whether the file exists, it asks the files package's `standing`, not lstat: after moving `a.ts → A.ts` on a case-insensitive filesystem, lstat of the old name finds the new file, and the delete would lift, leaving a move without a source in the journal. An intent at a root that cannot be told is absent (a root or store read failure) waits for the next startup.

While a line is `writing`, the command chain and holder reads see it, so the same thread's command never writes the transition twice.

Deleting a file with no readable lines may carry no `before` digest: unknown old contents, not a file that was never there. Holdings keeps the fact's author and answers unknown if the text HEAD cannot match this delete; a binary HEAD judges whole. Restoring a writing-delete checks only the directory record: absence confirms the delete, an existing record removes the intent, and an unreadable place stays unresolved.

A line's place is the addressed resource's checkout: write/edit follow the symlink (`CheckoutPaths.resourceAcross`), delete/rename address the directory record (`CheckoutPaths.placeAcross`): the path's directories resolve to the on-disk spelling, while the file keeps the name it was called by. On a case-insensitive filesystem, `Theme.ts` next to a standing `theme.ts` is its own place: otherwise a case-change move would lay the write fact on the old name, and the journal would hold no move. Queue and fact carry one `target`; write/edit pin the physical address in `PreparedPath.resource` before waiting for the queue and pass it to the read, the comment lexer, CAS, the fact, and `shown`. Redirecting the source link never redirects the act; swapping the bound address itself for a link yields a CAS miss. The line mode follows the found place, so a record-symlink line never turns the target's line into a symlink line. Files outside machine checkouts, the graph store, and Git metadata never become lines. Foreign harnesses' `record_write` rides the same road without steps 1, 3, and 4 (`Intake.report`): the line and mark land when reported, and between the file write and the message a command may take the shift — weaker, and the operation contract says so.

The origin checkout computes at use through the same `CheckoutPaths` (`checkoutAt`), never taken from `WorkingRoot.registration`: that snapshot freezes in the saved target and the world cache. A root that is no project checkout fails `checkoutAt` with a typed `CheckoutUnknown`, never with an empty answer.

A mass delete holds its roots' place in the call context (`Intake.basis`) before the first mutation — the paths and matches its operands named, the normalization of file roots, each touched checkout's HEAD in which the root lies or which stands inside it (`CheckoutPaths.rootsWithin`). HEAD pins by checkout, not by record, because records inside the tree become known only by walking at execution, and the Git directory may stand next to them (`--separate-git-dir`) or in a neighboring checkout (a linked worktree's shared directory) and leave first. Descendant normalization reads live metadata, so the walk deletes `.gitattributes` then the directory's `.git` after all its other entries, and roots under such names go after the rest. Otherwise deleting `.git` or `.gitattributes` would strip later facts of their basis or change their meaning. A normalization read failure refuses, never substitutes false: a CRLF file whose metadata already left stays undeleted with this refusal. This is the act's snapshot, with no lock on the whole tree; path queues and file intents stay separate, and when the call ends or cancels, the snapshot context releases.

For a directory root, the basis reads once which paths git ignores under it and where each touched checkout's git metadata lies (`cover`). A walked write's place resolves from this in-memory snapshot, with no git on write. An ignored path with no standing line never becomes a line: Holdings' court cuts such a path anyway before working-byte reads and folding, and a line with every `node_modules` file's text would cost more than the delete itself. Whether a line stands, each batch asks with one query over its ignored paths (`records`), not the starting snapshot: a line another writer laid while the delete ran would otherwise keep holding a file deleted with no fact. The answer is remembered in the basis, so the same batch's queue and landing see the same decision. A line laid between that query and `unlink` stays without a delete fact — the same leftover race as CAS. A fact batch lands through `landEach`: one intent per batch, each file's write answers its own result, misses lift, the rest confirm together. Holder announcements inside a basis accumulate and go out with one `announce` per holder when the call ends, never waking Holdings' court per batch.
