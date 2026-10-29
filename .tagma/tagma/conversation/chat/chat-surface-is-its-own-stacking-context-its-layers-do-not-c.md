---
id: 01a15add-1432-75d2-b007-d57d3425c4d8
title: "Chat surface is its own stacking context: its layers do not compete by z-index with surrounding app layers"
ord: 55
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/chat-ui/src/ChatSurface.svelte
---
The chat surface is its own stacking context: its layers do not compete by z-index with the surrounding app layers.

Inside `ChatSurface` layers stand on their own z-index: the input field is `z-40`, the file-intake overlay and message popups are above `z-[130]`. The surface root holds `isolate`, so all these numbers are compared only with each other. Without it they leave for the host context: the input field draws and takes clicks above any app layer with a lower z-index lying over the surface. `@container` does not create a stacking context, so `isolate` is needed separately.

Cost: what the surface draws via `fixed` without a portal (the touch pad under the context indicator) covers only the surface itself, not the app header.
