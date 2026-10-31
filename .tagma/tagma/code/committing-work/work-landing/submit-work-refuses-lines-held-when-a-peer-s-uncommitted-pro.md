---
id: 01a19101-f7d4-7d4c-af5f-7bfd934642cc
title: submit_work refuses lines-held when a peer's uncommitted Proxy trap named get matches any .get call in the landed file
ord: 164
tags: ["reflection"]
fields:
  {
    "actual": "refused[lines-held]: \"selected references require uncommitted declarations: get in protocolRig.ts:418\" held by an idle peer; the only exits are waiting or carrying the peer's unrelated unfinished lines.",
    "command": "submit_work paths=[\"apps/tagma/server/src/composition/testing/threads/hostedCosts.itest.ts\"]",
    "expected": "A one-line assertion change in hostedCosts.itest.ts lands; it references nothing a peer added to protocolRig.ts."
  }
---
Filed from project `tagma`. Received by a server up since 2026-10-30T23:02:50.633Z, from 65684db2.

protocolRig.ts:418 is a `get(target, key)` handler inside `new Proxy(sessionStore, { … })` that a peer (attendance-race, 01a190d6) added in uncommitted lines. hostedCosts.itest.ts imports `heard` and `until` from protocolRig.js and calls `Context.get(...)` on effect's Context, never the Proxy. The member-name check treats the Proxy trap as an exported declaration and the `Context.get` calls as references to it. The same refusal also blocked a 21-file landing until the test file was cut out of it (that landing then went through as 5d83b434ef). A Proxy handler method is not an importable declaration, and a member call on a receiver imported from another module (`effect`'s Context) cannot reach it.