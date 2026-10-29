---
id: 01a14bc5-0df5-77c8-b1a2-6948b2fd65e7
title: "A block's page shows it whole and edits in place: title, body, fields, links, sources, and subtree"
ord: 2
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-69419b982509
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/block/BlockFacts.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/block/BlockPage.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/block/Body.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/block/Subject.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/references.ts
  - kind: file
    ref: apps/tagma/app/src/routes/[project]/b/[id]/+page.svelte
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/graph/block/bodyEditor.ts
    symbol: bodyEditorExtensions
---
**Value.** The operator sees a block whole and edits it in place: title, body, fields, links, sources, and subtree, with no separate edit form.

**How.** A block's page by its name; links, outline, journal, and feed cards lead to it.

**Behaviour.**
- Title and body edit in place; the body is a markdown editor with live block and thread links. A custom label is preserved; a link without a label follows the current name; a thread opens in its own project by the general Opening rule. Showing the name never changes the link's stored goal.
- Fields of the tag stand under the body. A `#tag` node shows its declaration and findings, a rule its delivery and enforcement. Reflection facts and a research `source` row come from the tag's declaration, not its name.
- Links show by meaning and direction, together with references both ways; links from finished blocks are collapsed.
- A view shows query results, other blocks an outline of the subtree.
- A deleted block shows with a restore button, including when it was deleted while its page stood open.

**Limits.** Another project's block opens at its own project's address. An edit refusal arrives as a notice.
