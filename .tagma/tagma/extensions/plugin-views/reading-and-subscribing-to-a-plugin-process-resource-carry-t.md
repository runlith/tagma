---
id: 01a123fd-3375-7b9c-aff8-f722b2c7cbe2
title: Reading and subscribing to a plugin process resource carry the calling view's project, and the process admits each new subscriber itself
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/views/shelf.ts
---
A plugin's process is one per machine and serves all projects, so it can limit a project-dependent resource (CRM addresses them as `crm://project/<id>`) only by the caller. `ViewShelf.read` and `watch` pass the mounted view's caller `operator {projectId, view}` in `_meta['runlith/caller']` on `resources/read` and `resources/subscribe`, as with `tools/call`; the URI stays opaque to the host — refusal is the process's business. Another project's view of someone else's MCP App likewise passes `operator {projectId, view}` to the server in `read_mcp_resource` and `mcp.resource.subscribe`; here `view` is the view resource from the feed record. MCP pools are split by project, so this matters for a shared HTTP service.

`McpSession` holds one protocol subscription per URI but admits each new caller with a separate `resources/subscribe` carrying its caller. A view of project A cannot join a subscription project B opened until the process admits it; only it gets the refusal. `resources/unsubscribe` goes out when the last caller leaves, carrying its caller. The MCP Apps' document cache (`appDocument`) reads anonymously, so a caller-dependent answer never lands in the shared cache.
