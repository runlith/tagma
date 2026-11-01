---
id: 01a19591-10e6-7cd0-8c77-7aa9f9f60ee4
title: Every capture registers its own stop, so one operation stops any capture without knowing who opened it
ord: 27
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/speech/contract/service/captures.ts
  - kind: file
    ref: apps/tagma/server/src/speech/listening/captures.ts
---
The capture registry holds what each open capture's owner registered beside it: a kind named by that owner, its noun for the chip, and the effect that stops it. `stop_capture` and the capture chip only call that effect, so a new capturing module needs no case in speech and the chip needs no operation of that module. Recognition registers its finish, which ends hearing and leaves the confirmed tail to arrive on the recognize feed after the stop answers; a kept listening registers its own stop. A stop's refusal comes back as `stop-refused` with the owner's reason; stopping all runs every registered stop before answering the first refusal, so one owner's refusal never leaves the others unstopped. Entries are keyed by kind and id as a pair, never a joined string: both are owner-named strings, and a joined key would let one owner's capture replace another's stop.