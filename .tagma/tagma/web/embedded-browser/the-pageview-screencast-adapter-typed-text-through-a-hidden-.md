---
id: 01a1488e-00b6-789e-b91f-675786f99f37
title: "The PageView screencast adapter: typed text through a hidden textarea, control keys from keydown, touch as tap and wheel scroll"
ord: 6
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/browser/screencast/Cast.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/browser/screencast/CastView.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/browser/screencast/input.ts
---
The view holds focus in a hidden `textarea`; `mousedown` on the frame cancels the default, otherwise the browser would drop focus to `body` right after `pointerdown` set it. Typed text arrives as `beforeinput` or a composition end and leaves as a `text` event — that is how IME, Cyrillic, and phone keyboards work; control keys and combinations leave as `key` events from keydown, which cancels the `textarea`'s own edits. A character with Option or AltGr (Ctrl+Alt) is typed text, not a combination. ⌘C and ⌘X send `copy` and put the answer in the clipboard; pasting sends the buffer text. The mouse sends press, move, and release with a click count kept by the view; a release and a pressed-button move past the frame edge clamp to the edge so the page button never stays pressed; a touch becomes a click on tap and a wheel on finger move, in page CSS pixels; `touch-action: none` keeps the browser from scrolling the frame itself.

A frame decodes with `createImageBitmap`; a frame decoded later than the next one is dropped. A hidden tab unsubscribes and resubscribes on show, with the current area size. A closed view never reopens the subscription, even when the input answer arrived after closing. Files leave in one shared-socket message, so a view never sends more than 11 MiB at once: the base64 must fit in the 16 MiB default Bun websocket message. Input accumulates to an animation frame — the wheel sums, moves collapse — and leaves in one `browser.input` call with the next `seq`; an area-size change travels the same flow as a `view` event. Screencast subscribes on a separate socket so frames never delay other feeds.
