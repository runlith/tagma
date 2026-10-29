---
id: 01a0cf4b-e139-76b4-80cc-af9f930e0cfb
title: "Make the inject binding a lane: bound to the execution of its first act, admitting bytes, interrupt and resize there, ended by a transfer"
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0cfa9-3277-7ded-9322-6f277cafda77",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0cf56-281d-7ffa-a766-934722097468
---
Build the host part of [[22097468]] (section 5, Host) in `packages/execution-host`, with no change to the wire and no new refusal tag: the lane's execution checked and recorded atomically in `ControlBindings.authorize`, `admits` for lanes, lanes ended on a transfer, `CloseBinding` answering `Unbound` for a binding the host no longer holds, the host declaring that it admits lanes in a figure its own code answers (the capability profile's `version` rising to 2, set by the host rather than taken from the profile the server supplies), and input receipts retained per lane — 32 each, a host constant — within the execution's `input.receipts` raised to 128 in `apps/tagma/server/src/terminals/executionPolicy.ts`. Do not touch `refusalOf`: [[26641770]] and [[b8f0f683]] are held by another session. `host.ts` is shared with [[8cb4e34f]] by region: read `read_changes` before a wide edit. Done when the host suite cases of its section 7 pass, rule [[39f511b4]] reads as revised, a reviewer on the builder's own rung found nothing left open (rule [[6ccec00a]]), and doctor over the touched paths is clean.