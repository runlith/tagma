---
id: 01a197f2-9564-73bf-b394-c4fdfa9e17a0
title: act_on_page refuses element-obscured for a ref covered only by a pointer-events-none overlay
ord: 52
tags: ["reflection"]
fields:
  {
    "actual": "refused[element-obscured] naming e117 (div.pointer-events-none.fixed.inset-0) twice; the same click by viewport x/y at the button's centre succeeded.",
    "command": "act_on_page {\"page\":\"01a197f2-1de0-743c-83df-700fb0071a46\",\"steps\":[{\"action\":\"click\",\"ref\":\"e96\"}]}",
    "expected": "The click lands on e96: the covering div.pointer-events-none.fixed.inset-0 takes no pointer events, so a real click at that point reaches the button."
  }
---
Filed from project `tagma`. Received by a server up since 2026-11-01T04:35:00.962Z, from b555dcaa0.

Seen on a tagma:try app (thread composer's mode button "Trust"), 2026-11-01. The obscured check appears to hit-test without honouring `pointer-events: none` on the topmost element; elementFromPoint already skips such elements, so the check likely uses a box overlap instead. Cost: two refused calls and a screenshot to find coordinates.