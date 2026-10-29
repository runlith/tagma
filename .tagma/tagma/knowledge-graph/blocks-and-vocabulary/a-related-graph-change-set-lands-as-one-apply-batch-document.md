---
id: 01a14bc5-0df5-77c8-b1a2-6940175cda66
title: A related graph change set lands as one apply_batch document — all or nothing
ord: 9
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-694624989efa
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/batch.ts
  - kind: file
    ref: apps/tagma/server/src/graph/work/batchFiles.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/contract/wire/operations/work.ts
    symbol: WORK_OPERATIONS
  - kind: symbol
    ref: apps/tagma/server/src/graph/work/Batch.ts
    symbol: batchLayer
---
**Value.** A related set of changes (a new subtree with bodies, edges, and sources) lands in one act. All or nothing: the graph never stays half-written.

**How.** `apply_batch` with a document passed as a file, text, or operation list. The document carries almost every act over the graph: creation, edit, work, links, sources, replacement, and deletion.

**Behaviour.**
- Blocks created in the document get labels that other operations reference, bodies and fields of the same document. The answer resolves every label.
- An operation's body can be given as a separate file.
- Any refusal rolls the whole document back and names the operation number. The answer names the file to fix and resubmit.
- Acts over someone else's work warn before launch, like single ones.
- Input operation references take the `<project id>/<name>` address; edge targets resolve by the same mechanism as single doors, including in another project. Stored fields carry bare names.

**Limits.** One document writes one project, while edges may lead to others. The blocks it edits, parents, source donors, and replacements stay in the document's project. A move to a foreign parent is done by a single `update_block` with one `parentId`; a batch refusal names that exit. The same operations' gates apply inside.
