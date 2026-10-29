---
id: 01a168e3-82ee-725b-88f3-671667feb29f
title: "The subject address is resolved once per call: the operation body gets it canonical, approval and the journal get the caller's input"
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/contract/service/place.ts
  - kind: file
    ref: apps/tagma/server/src/threads/addresses.ts
  - kind: symbol
    ref: apps/tagma/server/src/invocation/admission/place.ts
    symbol: placedContext
---
A thread is addressed by id or team name, and the operation body looks the thread up by id. So invocation itself resolves the address and gives the body an input where every subject address is written as its subject-kind owner names it (`SubjectPlace.canonical`; for threads, the id from `ThreadRecords.address`). Only `prepare` and `execute` get this input (`CallFacts.bodyInput`); admission, approval subjects, raises, confirmation, the key, and the call journal see the caller's input. The rejected alternative was replacing the decoded input at admission: then the operator's question and the key digest would name something other than what was sent, and a repeat under the key with a name would diverge from the first call.

The subject place and the canonical form read one answer: `SubjectPlace.call` yields a fresh context per call, invocation puts every owner's contexts into `placedContext` on each door, and resolution inside it happens once. After approval the native door reassembles the call with a fresh context (`refresh` in `nativePlace.ts`), so the body input carries the preparation (`NativePreparation.facts`) up to `execute`, not a re-resolution that could point at another thread between question and execution. Blocks keep the found copies in the call context (`crossingCall`) but declare no canonical form: graph bodies resolve names themselves.

A team name resolves only for the calling thread, at its birth root; the operator and external callers address a thread by id. An unknown address stays in the body input as is, and the body answers with its own `not-found`.
