---
id: 01a0cab6-e8b7-78c1-87f3-fb1a0e3c1284
title: Notice unblock lines are keyed by text, so a doubled line is a duplicate key
ord: 3
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/NoticeCards.svelte
---
The unblock lines of a notice render as `{#each notice.unblock as line (line)}` (`NoticeCards.svelte:92`) — keyed by the line text itself. A refusal whose `unblock` carries the same line twice (or two equal lines) hands Svelte a duplicate key: a console warning and a row update that can strike the wrong twin.

Key by index, or dedupe the lines where the refusal is read. Done when a doubled unblock line renders twice with no key warning.