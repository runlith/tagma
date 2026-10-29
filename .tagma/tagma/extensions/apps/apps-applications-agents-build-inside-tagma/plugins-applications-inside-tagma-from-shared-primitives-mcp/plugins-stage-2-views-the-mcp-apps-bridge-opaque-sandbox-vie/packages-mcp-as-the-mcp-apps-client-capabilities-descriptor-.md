---
id: 01a12310-3d85-7ead-bc27-87655e0589ab
title: "packages/mcp as the MCP Apps client: capabilities, descriptor and result _meta, resources/read and subscribe, app visibility"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12310-6a01-7a9e-add6-7844e28e13ab",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1227f-7522-78e3-a658-79b7a0a16218
---
The spec's “Stages and acceptance”, stage 2 section: the `packages/mcp` owner adds what a third-party MCP App needs to work with no Tagma SDK, plus the process→view channel via `resources/subscribe` and `notifications/resources/updated`.

Done when an integration test against a real stdio server with a UI resource shows: the client declares the MCP Apps capability, the tool descriptor's and result's `_meta` reach the caller, `resources/read` serves the HTML resource, the resource update reaches the subscriber, a tool with `visibility: ["app"]` does not enter the model's tool list.

Delivered: the `io.modelcontextprotocol/ui` capability, `_meta` and `outputSchema` preservation, `listResources` with cursor and entry metadata, scoped `subscribeResource`, the model-catalog filter on `_meta.ui.visibility`. Resource types at `@runlith/mcp/resources`. Checks: the package's typecheck, 19 unit tests and 54 integration tests with two workers; a new stdio accepter also covers a slow reader, a shared URI of two Scopes, dropping the last subscription, metadata-only listing, and cleanup after transport break. An independent Sol xhigh found three defects; all confirmed and fixed in one round. Landing: `6e3189e524`, fixes — `7269d2a326`. The Tagma server was not restarted; the browser bridge belongs to the stage's next tasks.
