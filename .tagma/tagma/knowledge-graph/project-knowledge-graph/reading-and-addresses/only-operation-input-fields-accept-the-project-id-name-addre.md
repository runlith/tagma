---
id: 01a15ade-6b77-7dd4-a000-cab5bcc075ed
title: Only operation input fields accept the `<project id>/<name>` address; stored graph data holds the bare name
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/fields.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/contract/wire/references.ts
    symbol: addressedRefsRefusal
  - kind: symbol
    ref: apps/tagma/server/src/graph/contract/wire/references.ts
    symbol: blockAddress
---
Only operation input fields accept the `<project id>/<name>` address; stored graph data holds the bare name.

A fork registered as a separate project carries the same block uuids, so a third project finds such a block's name ambiguous, and lengthening the name does not help. The `<project id>/<name>` address (`blockRef`/`blockMention`) picks the copy in any operation field, including a reference to a foreign project next to the call's subject, where `project` would hit `place-mismatch`. `BlockNames` (row filter by `projectId`) and `TitleNames` parse it, and `crossing.elsewhere` narrows the walk to the address project. So a consumer resolving a name through them gets the exact meaning with no parsing of its own.

The project id is local to the machine, and the graph in team storage travels by git to colleagues. So stored-value schemas — tag ref fields, catalog `tags`, module `for`, view queries and `query_blocks`, `rules.global.disabled` — take `nameRef` with the bare name. Operation input references in `apply_batch` accept addresses and `$handle`. An edge to a foreign graph is stored as the root graph's address and uuid anyway.

The block body is stored data too, and `[[<id>/<name>]]` in it does not count as a reference. So every body write refuses with `body-address` and names the bare name: birth, update, and exact block edits, the same in `apply_batch`. `set_module` names an address in a new card body among its shared `module-shape` refusal's errors. A body written before this refusal refuses on the next explicit body write. Silent normalization is rejected: it changes the author's text, and the anchor of their next exact edit stops matching. A tree file body that never passed through an operation is not judged by the mirror.
