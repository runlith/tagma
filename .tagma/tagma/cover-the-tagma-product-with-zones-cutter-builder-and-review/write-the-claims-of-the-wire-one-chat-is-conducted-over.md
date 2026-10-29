---
id: 01a0ca5e-42c3-736a-9ef7-5db3138aca55
title: Write the claims of the wire one chat is conducted over
ord: 162
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0ca5c-5906-74eb-a8b8-6650cb732496
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
---
Read `packages/chat-ui/src/ChatTransport.ts` with `ChatTransport.test.ts` and `ChatRealtimeConnection.typecheck.ts` beside it. Write the claims under [[8916a0dc]]; the module is [[cb732496]].

What is claimable: what the transport requires of a connection it is given, how a subscription re-attaches and what it re-evaluates when it does, which payloads it reads as a snapshot and which as a resume, and where it projects the kernel's published wire rather than restating it. The wire's own law is the kernel's [[d1caad35]] — read those claims, particularly the ones over resume and the entry ceiling, before writing anything that sounds like them.

Reference zones: [[d1caad35]] and [[de36c9fd]] — match their precision, never their size. Proof: claims written from the code and not from the comment beside it, each bound to the narrowest sources that can contradict it and verified after reading them; the area's body corrected where the code contradicts it; the doctor over these paths clean; a review passed.