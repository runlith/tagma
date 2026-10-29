---
id: 01a1846a-6db1-794f-a8a4-b119a165f28b
title: The message rail's tiles change size only through `scale`, never width or height
ord: 4
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a18404-f6df-7814-bb9e-c815d7dbe006
sources:
  - kind: file
    ref: packages/chat-ui/src/MessageNav.svelte
---
Each tile keeps one box, the largest size it can take (current plus the full hover lift), and shows its resting, current or hovered size through `scale`; its transitions cover only scale, opacity and background colour. A width and height transition re-ran layout in every frame of the 150 ms transition, and the rail stands in the feed's container, so each pass walked the mounted feed — about 10 ms at 4× CPU — and every change of the current message during a fling made several long frames. The scaled box is centred in the same 16 px button, so the drawn sizes and their positions are the same as with laid-out sizes.