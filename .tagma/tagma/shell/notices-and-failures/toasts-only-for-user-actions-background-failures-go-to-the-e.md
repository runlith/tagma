---
id: 01a15099-cd9e-701b-a6c4-f1832352d112
title: "Toasts only for user actions: background failures go to the error list, the tag dictionary is not re-read on every project-list tick"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a125fe-9260-7644-9a64-589c9bc19e19",
    "status": "done"
  }
edges:
  - kind: validates
    to: 01a15099-abd6-7d56-85d4-049a2a197ac2
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/notices
---
The demo showed a “Not available in the demo ×6” toast: six background requests on open that the user never made. The cause is in Tagma, not the demo: `Failure` was filled by `Notices.refusal`, which decided “toast or not” by the shape of the error (`words`/`gate`) rather than by who started the work; `TagCatalog` watched the whole project list in `$effect` and re-read the dictionary with a report on each of its updates. Fix: `Notices.background` and `Failure` go to the error list; background reads of services (ModelDefaults, Favorites, AgentTypes without rescan, Subject, terminal layout records, GraphView edges) go there too; actions that went through `Failure` (opening a link, peek) become toasts; the toast has no counter; `Workspace.contextId` is a derived id, `TagCatalog` watches only it. Proof: the refusalNotice test through a real `NoticesLayer`, typecheck, demo without the toast.
