---
id: 01a18891-01d5-75d8-abeb-eb988a3b9370
title: The client metadata document signs in only where it lists the calling door's exact callback; otherwise the sign-in registers
ord: 12
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/mcp/signIns.ts
  - kind: file
    ref: packages/mcp/src/mcpOAuth.ts
---
An authorization server that matches redirect addresses exactly refuses a client metadata document that does not list the address the sign-in returns to, and the person has no way past it. So the document (`mcp.clientDocument`) is the one owner of which doors it serves: each sign-in reads it from its address and uses it only when its `client_id` is that address and its `redirect_uris` hold the calling door's callback byte for byte. Nothing in the code lists ports or channels, so a new channel or a document the person publishes needs no change here.

A document that is unreadable, answers an error, is not a client metadata document, or does not list the callback is skipped, not fatal: the order goes on to dynamic registration, as where the server does not support documents, and `sign_in_mcp_server` answers `skipped` with the reason. When the server offers no registration either, the refusal `mcp-sign-in-unsupported` names the same reason.

A client kept from an earlier sign-in is reused only if the person pre-registered it or it was registered for the same server and covers the callback. A kept document client is not reused: it is judged again against the document as it stands, since the setting or the list may have changed.