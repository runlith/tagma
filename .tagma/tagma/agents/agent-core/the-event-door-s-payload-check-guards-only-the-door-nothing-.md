---
id: 01a0c96d-24ec-72e1-bb33-9c72e8e39d1c
title: The event door's payload check guards only the door nothing calls, while every production write appends unchecked
ord: 135
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: packages/agent/src/thread/ThreadEventDoor.ts
    symbol: acceptSealedThreadEventsIn
  - kind: symbol
    ref: packages/agent/src/thread/ThreadEventDoor.ts
    symbol: appendThreadEventsIn
---
`ThreadEventDoor.ts` declares two doors. `acceptSealedThreadEventsIn` is the one every production write reaches: it seals, places and folds, and at the append it calls the journal directly. `appendThreadEventsIn` is the other — it lands sealed facts and reads nothing else, and before each append it calls `replayableThreadEvent` to check the payload's shape.

`replayableThreadEvent` has exactly one call site, inside that second door. And that second door has no caller anywhere in the monorepo except its own test file: its file rides `./thread/ThreadEventDoor`, but nothing in `apps/` or `packages/` imports the function. So the shape check runs only on a path nothing takes, and the path every write takes has no shape check at all.

Two ways this is wrong and they need different answers. If the check is worth making, it belongs on the door that is used, and the fix is to apply it there — which is a behaviour change, because payloads that land today would begin to be refused, so it wants a reading of what actually flows through before it is turned on. If the check is not worth making, then it and the door it guards are both dead and should go, and the claim that the kernel checks event payloads at ingress should never be written.

What must not happen is the state it is in now, where the guard exists, reads as protection to anyone opening the file, and protects nothing. A reader who trusts it is worse off than one who never saw it.

Done when either the production door applies the check and what it now refuses is known, or the unreached door and its guard are removed together — and in both cases the claims under this area say which of the two happened.
