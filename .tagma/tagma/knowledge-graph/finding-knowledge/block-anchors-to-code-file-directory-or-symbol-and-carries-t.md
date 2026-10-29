---
id: 01a14bc5-0df5-77c8-b1a2-693384c58394
title: Block anchors to code — file, directory, or symbol — and carries the anchors along with the code
ord: 1
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-693555927d12
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/contract/wire/operations/sources.ts
    symbol: SOURCE_OPERATIONS
  - kind: symbol
    ref: apps/tagma/server/src/graph/sources/placement.ts
    symbol: sourcesLayer
  - kind: symbol
    ref: apps/tagma/server/src/graph/sources/readers/place.ts
    symbol: sourcePath
  - kind: symbol
    ref: apps/tagma/server/src/graph/sources/relocation.ts
    symbol: sourceRelocation
---
**Value.** Knowledge is found by the code it is about, and after the code moves the anchors move with one operation instead of editing every block.

**How.** `anchor_block`, `unanchor_block`, `reanchor_path`; sources at block birth and in `apply_batch`; the sources section on the block page.

**Behaviour.**
- A source points at a file, directory, or symbol. A directory sets an area's territory, a file or symbol the record's subject.
- A source passes from block to block in one act.
- `reanchor_path` moves every source on and under the path, plus a renamed or moved symbol.
- An untagged note takes file, dir, and symbol sources in any project. They take part in ownership, navigation, and search, and move and transfer with the same operations.
- For blocks with tags the allowed and required sources are set by tag declarations; the last required source is never removed.
- A source by itself never delivers the note's text to the file's reader or writer: for that the type supports `core/explanation`.

**Limits.** For file and dir the path form inside the project is checked; symbol additionally requires a file with a top-level declaration, when the language parses. When even one moved source would collide with one already standing, the whole move is cancelled. A module's directory and files are moved only by `set_module`.
