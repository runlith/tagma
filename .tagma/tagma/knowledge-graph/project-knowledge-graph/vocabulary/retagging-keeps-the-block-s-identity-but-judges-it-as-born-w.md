---
id: 01a16920-e7cc-7d05-8452-be4aa60b384a
title: Retagging keeps the block's identity but judges it as born with the new tags and silently drops nothing incompatible
ord: 4
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a14bae-4498-7d2b-9809-f52fa117fc42
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/blocks/retag.ts
---
Retagging keeps the block's identity (uuid, place, edges, sources, references) but judges everything else as if the block were born with the new tags: the old tags' status and holder leave, the new lifecycle's fields stand at the initial word, required fields, the body cap, declared sources, and edges are rechecked. So only a block in the initial word and without a holder is retagged: otherwise the change would wipe the turn history or the ending that its operations write and the journal reads. A block in work is first released, a finished one reopened.

The server silently drops nothing. A field value the new tags do not declare is removed only by an explicit `null` in the same call; an edge the new tags do not declare (core edges like `relates` need no declaration), an edge whose side is now of the wrong type, or a source of a kind the nonempty new tag set does not declare, refuses with a "remove first" exit. On removing all tags, file, dir, and symbol sources stay with the note. The alternative — dropping the incompatible and keeping it only in the journal — was rejected: an agent does not notice the loss, and only a manual journal read could bring it back. The enforcement rule is not removed, and not with `null` either: if the new tags' law does not hold the same enforcement field, the refusal is removed only by `enforce_rule` with `off`, because that is the only road by which strictness changes. The reverse is also a refusal: a carried value that only an operation writes under the new tags (holder, enforcement) but did not under the old ones is not endowed with meaning by the move — it is removed with `null`.

Pre-write checks judge the block as read before the writer lock; inside it the block is read again, and if its tags (and for retagging — fields or body) changed meanwhile, the call is judged wholly anew under the same lock instead of writing over the unchecked. An edge to another graph whose target after the change would fall under another type restriction is not judged from here and therefore refuses with a "unlink first" exit.

Types born by their own road and carrying their own machinery are never retagged in either direction: modules (`set_module`) and tag and catalog declarations (the project vocabulary). Edges to this block from other graphs are invisible from here and unchecked; open-children is not checked because retagging does not end work.
