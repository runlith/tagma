---
id: 01a184ff-b57f-7dd1-8cf8-fc06c89d5aac
title: "A scrollbar thumb drag undoes the feed's corrections: the content jumps against the drag"
ord: 11
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a18353-fb8c-7866-916b-78b406aa5d8d
  - kind: implements
    to: 01a18327-c7aa-7718-b037-fece2ea21922
sources:
  - kind: dir
    ref: packages/virtual-list
---
While the reader drags the scrollbar thumb up through unmeasured history, the window corrects `scrollTop` for rows that mount above with a different height. The correction itself is right. But the engine maps the thumb to `scrollTop` from the pointer, so the next pointer move undoes the correction, and the content jumps against the drag by about the correction's size. In stand run.87412.1793232518199 (Chromium host, 4×, `frames-host.json` of thumb-history), one 128-step drag had eight reversals of +90 to +309 px. Each was a non-structural frame right after a frame that carried a correction. The desktop app runs on Chromium (Electron), so it has the same mapping.

Direction: while a thumb drag is in progress the library writes nothing. It holds the corrections through the hold it already keeps for iOS momentum: rows and the total shift, the scroll extent the engine maps the thumb against stays fixed, and the hold folds in one write when the drag ends. virtual-core 3.19.8 holds only for an iOS gesture or overscroll, so the binding needs a predicate from the consumer that says "a write cannot land now", added to the kit's virtual-core patch, plus a fold when the predicate clears. The thumb drag must be recognised from what the page actually receives during one: measure that first in Chromium, both headless and with macOS overlay scrollbars headed, and in WebKit. The boundary of a hold that lasts the whole drag (a strip at the top when a drag reaches row 0 with corrections held) follows the library's iOS behaviour and is judged by the stand.

Proof: thumb-history green in Chromium host and Win32, with no frame where content moves against the commanded direction, after the stand's quantum and reversal checks land. The other lanes stay green, and a unit test in the kit shows a correction held during a drag and folded at its end.