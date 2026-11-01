---
id: 01a15033-a613-7d2d-beee-2f1c999bf9fa
title: "An app feature never takes the environment itself: network, desktop bridge, storage, address and browser globals arrive as services filled in by composition"
ord: 39
tags: ["rule"]
fields:
  {
    "delivery": "code",
    "enforcement": {
      "debt": [],
      "escaped": [],
      "inspection": "environment",
      "on": [
        {
          "op": "submit_work",
          "phase": "before"
        },
        {
          "op": "merge_worktree",
          "phase": "before"
        }
      ],
      "strictness": "gate"
    }
  }
sources:
  - kind: dir
    ref: apps/tagma/app/src
  - kind: dir
    ref: packages/chat-ui/src
---
Only composition (the window fillers in `app/window.ts`), `wire` and the `Platform`, `Host`, `Router` and environment-service fillers may read them directly. Clipboard, user gesture, microphone and the facts of the document the app renders into are allowed everywhere.
