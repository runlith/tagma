---
id: 01a14bc5-0df5-77c8-b1a2-692b40ccf5cc
title: Agent and operator create a graph block and edit its title, body, fields, and tags; the body — whole or by exact piece replacement
ord: 1
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-692c885d68e2
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-692f1e9ecb91
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-6932d9f44168
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-693384c58394
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-6940175cda66
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-694624989efa
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/blocks/bodyFile.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/blocks/birth.ts
    symbol: blockBirth
  - kind: symbol
    ref: apps/tagma/server/src/graph/blocks/edit.ts
    symbol: blockEdit
  - kind: symbol
    ref: apps/tagma/server/src/graph/blocks/guards.ts
    symbol: assertBodyCap
  - kind: symbol
    ref: apps/tagma/server/src/graph/blocks/update.ts
    symbol: blockUpdate
  - kind: symbol
    ref: apps/tagma/server/src/graph/contract/wire/operations/writes.ts
    symbol: WRITE_OPERATIONS
---
**Value.** Agent and operator write knowledge about the project straight into the shared graph, with no markdown files beside the code. A long body is fixed by exact replacement of a piece, with no whole rewrite and no loss of someone else's parallel edit.

**How.** The `create_block`, `update_block`, and `edit_block` operations; in the app the title and body are edited on the block page and in outline.

**Behaviour.**
- A block is born at once with tags, fields, edges, and sources; without tags it is an untyped note. A core contract can stand in for a tag, and the server picks the type from the installed catalogs.
- A new block can be born in a worktree graph copy, keeping the thread's domain in another project; in team storage it arrives in the main graph with the branch merge.
- Fields are checked against the tag declaration. Fields owned by operations (status, holder, enforcement) are not written that way. `null` in fields clears the value.
- A living block's tags change in place: name, place, edges, sources, and references stay; the new tags' lifecycle starts at the initial word, as at birth. A block in work, held, or finished does not change tags until released or reopened. Everything the block carries must hold under the new tags too: a field value the new tags do not declare is cleared with an explicit `null` in the same call, and an unfitting edge or source is named by the server and offered to clear first.
- After a title or body change the answer lists the blocks referencing it, so they are reread.
- An exact replacement refuses when the piece is not found or found several times, and hints that a parallel call just changed the body.
- A long body is passed as a file.

**Limits.** A replaced block is not rewritten. A module is neither created nor moved by these operations. A tag can cap the body length. A tag the project did not declare is refused: enable the catalog carrying it or declare your own.
