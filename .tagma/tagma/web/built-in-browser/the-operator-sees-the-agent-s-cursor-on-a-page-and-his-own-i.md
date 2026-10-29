---
id: 01a184e9-acb7-7aa5-b270-ce2073c47652
title: The operator sees the agent's cursor on a page, and his own input on the page holds the agent's actions until he stops
ord: 19
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18433-d315-73f4-812d-a71e5c06e846",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-0469ea44a461
---
The operator accepted (2026-10-29): on a page an agent drives, the operator sees where the agent points and acts, and his own input takes the page over with no control of its own — rule 0f144655 forbids a take or claim button. Today (feature ea44a461) both act at once with no coordination, so the agent's next step can overwrite what he types or click past his scroll, and only open DevTools stop the agent.

- **Hold.** Human input on the page — the native view on desktop (main sees it before the page) and a screencast viewer's input (the server sees it) — marks the page as worked by the operator; agent actions on it refuse with a typed refusal whose unblock says to wait or ask him, until his input has been quiet for a short bound the engine owns. A step already running is not torn mid-input.
- **Cursor.** The agent's pointer and the element it acts on are shown to the person watching, in the native view and in the screencast, live and briefly after each action. Nothing the page's own scripts can detect, and nothing in the agent's own captures.

Check while here: a capture taken while element picking is on showed the pick highlight over the element (seen 2026-10-29, not reproduced) — captures must stay clean of every overlay of ours.