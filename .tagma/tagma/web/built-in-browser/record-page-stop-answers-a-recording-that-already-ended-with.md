---
id: 01a185c3-5481-73e4-bd83-abf5f360b83a
title: record_page stop answers a recording that already ended, with how it ended and by whom
ord: 40
tags: ["task"]
fields:
  {
    "holder": "tagma:01a185ad-5d95-781b-ac4b-c7ffd9e300d0",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a185ac-ca1d-7f60-a98a-858248dbefb7
---
A recording belongs to the thread that started it however it ends, and its video plays in that thread's feed (operator's decision). Today an operator Stop from the panel, a run end, a page close or a lost session leaves the agent with only the start card, and a later `record_page stop` refuses `no-recording` while naming the file. `stop` after such an ending answers the ended recording's `recorded` result — file, duration, size — plus how it ended and by whom, so the feed's tool card plays it. The result is kept per page until it is collected or a new recording starts on the page; `no-recording` refuses only when nothing was recorded. Grammar, feature 21312206 and explanation 5de00096 follow.

Acceptance: screencast scenarios prove, red then green, that after an operator stop, a run end and a lost session the agent's `stop` answers `recorded` with the file and the ending, and a second `stop` refuses `no-recording`.