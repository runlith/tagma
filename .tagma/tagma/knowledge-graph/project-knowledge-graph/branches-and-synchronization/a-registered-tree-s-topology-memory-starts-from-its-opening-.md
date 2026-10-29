---
id: 01a16e3f-362a-7560-993f-65a72b689623
title: A registered tree's topology memory starts from its opening's last sync, and merged twins are not remembered in it
ord: 7
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a16e1d-d386-74b8-85eb-1eb7e79786bf
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/serving/freshness.ts
  - kind: file
    ref: apps/tagma/server/src/graph/tree/topology.ts
---
A tree's watch opens after the opening sync. Its first rescan (`opened`) marks topology stale, and refresh replays it: closing the gap between the sync's end and the watch's start. The replay first reads topology (`readTopology`) and runs a full `syncTopology` only when the read says "due".

Empty memory (`checkouts: null`) always yields "due", so every opening synced topology a third time. Registration takes `checkouts` and stranded branches from the opening sync. A checkout departed after it and a twinless new branch still yield "due".

`absorbed` stays empty: the tip the opening sync merged is known only from the topology read (`TopologyReading.merged`), which sync never returns. So a tree whose branch absorbed other branches with twins replays a full sync, as before. The reverse error — a memory saying "merged" about what never merged — would lose a graph merge.

Memory also holds the current branch's remote-branch tip that sync already absorbed or found contained in the tree; registration takes it from the opening sync. Without this every topology read with a standing remote branch would be "due".
