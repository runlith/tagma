---
id: 01a11291-2c06-747d-9b4e-3452db0541d5
title: "A recap asks over the thread's warm copy alone: a manual one without a copy refuses not-warm, an automatic one waits for a copy with a promised warm deadline"
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/recap/questions.ts
  - kind: file
    ref: apps/tagma/server/src/threads/recap/readings.ts
  - kind: file
    ref: apps/tagma/server/src/threads/recap/schedule.ts
  - kind: symbol
    ref: apps/tagma/server/src/threads/list/store.ts
    symbol: ThreadListReads
---
`/recap` asks for the current thread's summary at once: with no automatic pause, no two exchanges, and no condition that the operator already wrote into this thread. Manual and automatic writing share one generator and one publication, so they keep the same format, basis, index-integrity check and cancellation on conversation change.

A recap only ever asks over the thread (`ThreadAsks`), never a fresh model: the operator decided on 2026-10-30 that a recap rides the hot cache alone. When `ThreadAsides` holds a copy of this run's last request — a native capture or a vendor session over ACP ([[f3949b43|side question]]) — recap asks it. `ThreadAsides` holds the copy until its cache deadline ends, and with no declared deadline — until the run ends; an ACP session copy also leaves with the vendor process end; recap keeps only the basis metadata, not a second link at history. With no copy (after its deadline, restart, offload, on a transport with `aside: none`) a manual request refuses `not-warm`, laid down as the thread's recap attempt where a said message anchors it.

Automatic writing goes only over a copy with a promised cache deadline: a deadline-less copy never schedules it, and before asking recap reads the thread line's warmth (`cacheWarmthOf`, the same fact as at the list and `list_agents`) and writes only when it is `warm` on a `promise` basis (rule [[eba592c4]]).

`threads.recap` governs automatic writing. Switching off neither cancels an explicit manual request nor hides a stored summary in the card, Peek or readings: otherwise the operator would receive an invisible result of a performed command.
