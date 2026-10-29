---
id: 01a18980-a00b-7551-bedc-902a013394ee
title: A sign-in record keeps every scope it asked for, and each new sign-in of it asks for all of them
ord: 16
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/mcp/signIns.ts
---
The record keeps the scope its last completed sign-in asked for, and every new sign-in of the record — a step-up after a 403 `insufficient_scope`, or one after signing out — asks for that scope joined with the challenge's, or with `scopes_supported` where the challenge names none, as the MCP authorization step-up flow requires. A step-up asking only for the new scope lets the new grant replace one that held the old scopes, so a server used for reading and then writing stops reading.

The join is made again when the callback writes the record, so of two overlapping sign-ins of one record — two projects' step-ups of a user server — the one finishing last does not drop the scope the other asked for; its tokens may still lack it, and the next step-up asks for it again. What was asked is kept, never the token answer's `scope`: a server may omit it. Scopes asked of another authorization server or for another resource are not carried over. A revoked grant, or an expired one with no refresh, still sends the person through authorization again.