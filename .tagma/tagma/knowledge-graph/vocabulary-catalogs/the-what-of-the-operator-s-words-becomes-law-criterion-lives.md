---
id: 01a151e4-7e14-77bb-9eed-0a992147fa40
title: "The \"what of the operator's words becomes law\" criterion lives only in the core, and the #rule tag describes only the record form"
ord: 3
tags: ["idea"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/catalogs/contract/wire/softwareDevelopment.ts
  - kind: file
    ref: apps/tagma/server/src/graph/doctrine/graphWriting.ts
---
Right now one and the same sentence (an operator's correction to agents' work beyond the task is law; priorities, plans and orders for now are not; doubt is offered in a line) stands twice: in the core's "Writing the Graph" section (`graph/doctrine/graphWriting.ts`) and in the #rule tag prompt of the software-development catalog (`catalogs/contract/wire/softwareDevelopment.ts`). In a project with this catalog an agent reads it twice.

Option: the core keeps the "when" — the criterion about law in general (the `core/law` role), the tag keeps the "how" — the #rule prompt's first sentence becomes the definition ("#rule is this project's law: a standing obligation for agents' work"), then the record form without the trigger. A project with another catalog gets the criterion from the core, the law record from its own tag.

Unverified: whether any agent receives tag declarations without the core section (a foreign CLI harness); after the change it would stop seeing the criterion.
