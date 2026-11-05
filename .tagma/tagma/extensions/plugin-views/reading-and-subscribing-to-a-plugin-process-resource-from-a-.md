---
id: 01a123fe-04cc-720b-a4fb-0122b5ae34d8
title: Reading and subscribing to a plugin process resource from a view carry the caller's project and view in _meta, like a tool call
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1231d-b9cc-7eb6-be22-add828aa44c4",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a123d2-9480-7277-ae47-3c985a6bfa35
  - kind: implements
    to: 01a1227f-7522-78e3-a658-79b7a0a16218
sources:
  - kind: file
    ref: apps/tagma/server/src/views/shelf.ts
---
Closes [[b2c7cbe2]]: `ViewShelf.read` and `watch` call the process with no caller, so a plugin cannot refuse a view of project A requesting a resource of project B. The host passes caller `operator {projectId, view, threadId?}` in `_meta['runlith/caller']` on `resources/read` and `resources/subscribe` — the same as on `tools/call`. The URI stays opaque to the host. One subscription per URI for the whole session, so the subscription's caller is whoever opened it first; a plugin that cares about the project addresses the resource by project (like CRM: `crm://project/<id>`) and refuses on mismatch.

Done when the `views` itest shows the process seeing the caller with the mounted view's project in reads and subscriptions.
