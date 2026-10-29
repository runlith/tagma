---
id: 01a1161f-6874-7821-9cae-e2e6eea6e553
title: "Catalog and prompt: a spec is for the large, a task for any real work, no record only for a micro-edit"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a115c7-117e-79fb-9fe1-f2b10ab691c4",
    "status": "done"
  }
---
Agents propose a spec for almost every job and do not open a task for work they do themselves. The cause is the record-choice rule in the code-project catalog, the `#spec` and `#task` descriptions, and two sections of the agent prompt: a spec is defined as "accepted future behavior", a task as a coordination record.

Change (`catalogs/contract/wire/codeProject.ts`, `graph/doctrine/whatIs.ts`, `graph/doctrine/theCheckoutAndTheGraph.ts`): the operator's word decides first; a spec is for a large change; a task is for any real work, including work the same agent does in the same thread; no record only for a micro-edit; a task needs no spec; examples are generic.

Done when the texts are rewritten, catalog typecheck and tests are green, the commit has landed. The graph copy of the catalog is updated by the installer when the operator restarts the server.
