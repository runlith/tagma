---
id: 01a10ba7-815e-7dbe-86e5-13e23b671eda
title: The ACP live tail keeps record identity and releases only the recorded prefix
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/projection.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/row.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/steps.ts
  - kind: file
    ref: apps/tagma/server/src/threads/harness/turns.ts
---
ACP text and reasoning count parts separately, like the native feed; an empty part takes no number, and non-text block content translates identically for live and journal. A message boundary closes the live part and splits it from the next. The journal write and the release of the matching replay prefix pass under one snapshot cut: the later delta stays in the tail, and reconnect starts from the saved ordinals and sequence. Before publishing hosted-question awaiting, the kernel calls `TransportRuns.reached(run, 'all')`: the driver seals the unfinished message via the machine checkpoint and closes the live part so publication never loses it, and the next delta after the answer opens a new part — hence no awaiting-lifted signal. Resuming the same run keeps the sequence and opens replay from the current ordinals; driver recovery also picks up the unsealed message from the protocol row. The split-counter migration starts both from the old shared number, so already-issued ids stay the same.
