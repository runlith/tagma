---
id: 01a13ba3-4131-751b-a071-e5d8701222d2
title: "Four manual \"current value, then changes\" move to PubSub with replay: power/pace, power/awake, settings/live, composition/http/sites"
ord: 12
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13ba3-7d4c-7a7e-895e-d13a157327c2",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13b37-5351-7e3a-bda9-f7c22e414755
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/http/sites.ts
  - kind: file
    ref: apps/tagma/server/src/power/awake.ts
  - kind: file
    ref: apps/tagma/server/src/power/pace.ts
  - kind: file
    ref: apps/tagma/server/src/settings/live.ts
---
These places hand the subscriber the current value and then the changes, gluing read and subscribe by hand: a change between the two steps can be lost or arrive twice. `PubSub.sliding({ capacity: 1, replay: 1 })` + `Stream.fromPubSub` subscribes atomically; release-channel and checkout-builds already do that — take them as the model.

Don't touch the `Set` subscribers in thread-record and the projects registry: their contract is synchronous delivery after commit plus isolation or propagation of a subscriber failure, which PubSub does not give. Proof — at each of the four, a subscriber receives the current value and every following change; typecheck and module tests green; spans preserved.

Delivery `b4e9e1255a`: four replay hubs with scoped shutdown; settings keeps the acquired subscription via `PubSub.subscribe` + `Stream.fromSubscription`, since `Stream.fromPubSub` subscribes on first pull. Fixed the loss of latest at a full hub: `publishUnsafe` does not slide by itself. Eight contract tests passed, including three red→green on reader lag; spans and others' Set subscribers preserved. A narrow `bun check` passed 3301 files, no new effect-style violations; Sol xhigh and Muse xhigh review done. Final module run: 60 pass, the setup of three HTTP sites tests stopped at HTTP 409 from `add_project` and `doorFixture.ts:188`; that file passed before. The shared `bun run typecheck` stopped on others' unfinished edits. These two shared checks on the final shared tree stay unproved.
