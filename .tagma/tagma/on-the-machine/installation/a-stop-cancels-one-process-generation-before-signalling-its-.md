---
id: 01a1a262-3fd5-77db-bc2a-8e4c3db4331d
title: A stop cancels one process generation before signalling its members
ord: 77
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/contract/wire/process.ts
  - kind: file
    ref: apps/tagma/server/src/installation/process/chain.ts
  - kind: file
    ref: apps/tagma/server/src/installation/process/launch.ts
---
A generation's durable stop intent closes admission before its processes are signalled. Successors and automatic returns inherit that generation, so killing a predecessor or the stopping CLI cannot revive a cancelled handover; an explicit new launch creates another generation. The launch owner forks a supervised successor and a supervised return under the generation's lock, from the generation the predecessor's `Start` carried: each is a member before its own admission, and neither starts after Stop, whatever order the successor's death and the predecessor's `Cancel` reach the owner in. A server learns from the launch mark whether its owner returns into the generation; under an owner without the mark its membership stays unconfirmed. Issued predecessors and unconfirmed members cannot prove the fate of an unrecorded automatic return, so stopping them reports an unproven chain rather than claiming that Tagma stopped.