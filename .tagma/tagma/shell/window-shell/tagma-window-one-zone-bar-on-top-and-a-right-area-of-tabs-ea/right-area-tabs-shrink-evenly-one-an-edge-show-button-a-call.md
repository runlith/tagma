---
id: 01a156b9-b502-7afb-9810-3aa33a869692
title: "Right area: tabs shrink evenly, one \"+\", an edge show button, a call chip"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a125fe-9260-7644-9a64-589c9bc19e19",
    "status": "done"
  }
---
Per the mockup http://localhost:5634/a/1311046df799 accepted by the operator.

- `TabRail`: tabs shrink evenly to a minimum, then scroll with no bar, fading at the edges. "+" stands right behind the tabs; on overflow, "All tabs". The change is shared for files and browser.
- Thread-zone tool buttons and "…" leave. The "+" menu shows only views and "restore closed".
- The "show tabs" button stands at the right edge, with the tab count in a frame. With no tabs it opens the new-tab page.
- Call:
  - a handset in the bar, a chip while recording: time, level, Give(n) only when there is something new, stop;
  - microphone, sound, and the mark move to the call tab header.
- Bug: a press sometimes opens no area. Find the cause and fix.

Proof: typecheck, tests of the touched owners, review.
