---
id: 01a14bc0-76bc-7bce-a3ea-c23dafb820dc
title: A plugin puts a notice or a question to the operator in Attention and on the phone, and gets the answer back
ord: 2
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc0-76c7-7595-a09a-82c02494791d
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/attention/NoticeCard.svelte
  - kind: file
    ref: apps/tagma/server/src/notify/contract/wire/notification.ts
  - kind: file
    ref: apps/tagma/server/src/notify/handback.ts
  - kind: file
    ref: apps/tagma/server/src/notify/inbox.ts
  - kind: file
    ref: apps/tagma/server/src/notify/operations.ts
---
**Value.** A plugin — a Slack bridge, a trading desk — tells the operator "look" or asks "buy?" in the same place the agents wait for him, and gets the answer back.

**How.** A plugin that declared an outcome recipient calls `send_notification`; the operator answers or dismisses the notice in Attention and in the phone Inbox (`answer_notification`, `dismiss_notification`).

**Behaviour.**
- A notice carries a title, text, and an optional question — with options or a free answer.
- The outcome is decided by the operator's first action; a repeat gets the same outcome. The outcome reaches the plugin until it accepts it, including across a server restart.
- The send key makes sending repeatable: the same key returns the earlier notice.

**Limits.** Only a plugin process with a declared recipient can call; the number of a plugin's open notices is bounded. Turning the plugin off does not clear its open questions.
