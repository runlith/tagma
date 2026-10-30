---
id: 01a15539-b1a3-752b-b184-94e0485790ef
title: Text that does not fit in a Tagma interface line fades at the edge by default, not into an ellipsis
ord: 56
tags: ["rule"]
fields:
  {
    "delivery": "code"
  }
sources:
  - kind: dir
    ref: apps/tagma/app/src
  - kind: dir
    ref: packages/chat-ui/src
  - kind: dir
    ref: packages/primitives/src
---
Always applies, unless the operator or the spec said otherwise for a specific place; an edit to someone else's code where an ellipsis stands moves it to a fade in the same change. The `FadeText` component exists for this; `truncate` and `text-overflow: ellipsis` are not used for single-line text. The fade appears only when the text truly does not fit. The text producer never cuts it by character count: only the interface clips it, at its actual width.
