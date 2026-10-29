---
id: 01a160d7-ad4c-74cb-b813-350fb3f72685
title: The human refusal phrase comes from the refusal code's owner, not the app; every declared code has one
ord: 9
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a146ca-49a1-756b-8020-330d35c0e724
sources:
  - kind: symbol
    ref: apps/tagma/server/src/invocation/nativeDoor.ts
    symbol: phrasedRefusals
  - kind: symbol
    ref: apps/tagma/server/src/platform/contract/service/manifest.ts
    symbol: refusalWordsOf
  - kind: symbol
    ref: packages/agent/src/agent/tool.ts
    symbol: ToolRefusals
---
A refusal code is a contract for the agent, and the feed shows the person a phrase about what happened. So the phrase comes from whoever declares the code, not from the app: it does not glue it from the code, and for a record with no phrase it shows a plain "Refused".

- A tool declares `refusals` as code → phrase (`ToolRefusals`); `Tool.make` puts the phrase into the refusal (`ToolRefusal.words`) when the producer gave no own words for this case.
- At server operations, one module owns the code's phrase — the one owning the code, in `refusals` of its `OperationSet` (`contract/wire/refusalWords.ts`); shared call, place and git codes come from platform (`PLATFORM_REFUSAL_WORDS`), co-work codes from the agent kernel (`PLANE_REFUSAL_WORDS`), and server modules take them from there. Composition (`refusalWordsOf`) does not start when a declared code has no phrase or two modules give its phrase: otherwise a new code would silently show in the feed with no words.
- `GateRefusal.words` are the words of the specific refusal, they matter more than the code's phrase: a rule's court names the rule ("Blocked by rule "…"") and an operation's negative answer gives its presentation (`negative`).
- The phrase is short, with no period and no inner words: it stands after the call row and in toasts, where the refusal is drawn by `Refusal.told`.
