---
id: 01a10328-461a-7e58-98dd-955b8a8a3eda
title: "Code notes in runlith are rewritten as #explanation bound to code; untagged nodes of the same content are deleted"
ord: 1
tags: ["task"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/catalogs/contract/wire/softwareDevelopment.ts
---
**What.** Code notes in runlith become `#explanation`: each is bound to the code it explains and written to the tag's prompt. Old untagged nodes are deleted.

**Why.** The software-development catalog's `#explanation` declares sources and the `core/explanation` contract, so everyone opening or editing a file under its source receives the explanation on first touch. Untagged notes may carry sources and be found through `read_owners`, but a file's reader or writer never receives their text: explanation delivery requires `core/explanation`. Some of them also retell the code or carry measurement logs.

**When.** After the operator restarts the server: the graph step `software-development-names` renames the runlith catalog to `software-development` and its `#note` to `#explanation`. Check `read_tags`: `#explanation` stands, `#note` does not belong to it. An existing node's tag never changes, so each explanation is created anew.

**How.**
1. Start with the seven notes written 2026-10-03: 363b3e55, df760b9f, 9704eda8, 5e29b5dc, f8242dcd, 337a9d39, 570a4bee.
2. Then work through the remaining untagged nodes under modules. Port code notes. Leave non-code nodes — run logs, model comparisons, logs — as they are.
3. Rewrite each explanation from the code to the `#explanation` prompt. The heading states a fact. The body states the reason, the boundary, the prevented failure. No retelling of functions, field lists, constant values, or measurements; move measurements into the task that made them, if needed. The source is the narrowest code that could refute the explanation.
4. Never port a note that says nothing beyond what the code says.
5. Repoint other blocks' links from the old note to the new explanation, and delete the old one.

**Done when.**
- Code notes under runlith modules are `#explanation` with sources.
- Touching a file under a source brings the line `explained here — …`.
- No untagged copies of the same notes remain under modules.
