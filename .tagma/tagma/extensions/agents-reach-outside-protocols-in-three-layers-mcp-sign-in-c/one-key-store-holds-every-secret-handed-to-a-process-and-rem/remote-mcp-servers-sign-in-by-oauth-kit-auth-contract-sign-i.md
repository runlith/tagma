---
id: 01a18816-519c-7c83-bdca-b99143e5a01f
title: "Remote MCP servers sign in by OAuth: kit auth contract, sign-in records, door callback and live rows"
ord: 3
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a184c6-16dd-744f-b710-46e4142a1788
  - kind: waits-on
    to: 01a18816-519c-7c83-bdca-b98f197273fd
  - kind: waits-on
    to: 01a18816-519c-7c83-bdca-b990fc92b4ba
---
Part 2 of [[142a1788]], built over the key store and the refresh flight. Done when the spec's Sign-in, Rejected callbacks, Reconnect during a sign-in and Refresh acceptance pass.