---
id: 01a15162-fdbb-71ec-80d9-b3935d41f0fa
title: A symbol source anchors only to a symbol its file declares at top level; a language without declaration parsing is never judged
ord: 1
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a15146-226d-74ce-a96d-6c0b47fd0ae6
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/sources/declared.ts
---
Every new symbol-source place passes `Sources.place`, and a symbol rename passes `relocate`. Both read the file in the checkout the calling graph serves (without one — at the project root) and parse declarations with the `DECLARATIONS` facet from code-facts, the same as the rules judgement. A symbol the file never declares, or a missing file, means a `symbol-missing` refusal. Before, such a source wrote silently and quietly pointed nowhere.

Only the name's first segment is judged, because the facet knows only the file's top level. A class member or a function inside `make…` is written through the owner (`Owner.member`) — then `Owner` is checked. A language whose adapter never parses declarations, and a file that currently never parses, are accepted unjudged: refusing them would block a source that cannot be verified.

A file is always judged in a one-shot worker (`declaredNames.worker.ts`), which also picks the closest names for the refusal. The server process never loads a parser, eagerly or lazily: the oxc and typescript modules weigh tens of megabytes, and a first parse on the loop would cost about 80 ms. `enforcement/eventLoop.itest.ts` verifies this contract. The price is a worker launch per new symbol-source place: one measurement — about 95 ms at load around 8. The check stands inside the act's transaction, so the mirror writer is held the whole time.

Declarations read at top level without a full outline. A local name exported only under another name (`export { local as renamed }`) stays among the declarations.

This check never touches sources already standing in the graph and rows mirror repair brought from files: it judges the write of a new place, not the stored.
