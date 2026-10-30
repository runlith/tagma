---
id: 01a0ca6f-f1ed-7bf4-98d5-01dfa813a742
title: Show a step group's duration only after the group stopped growing
ord: 22
tags: ["rule"]
sources:
  - kind: symbol
    ref: packages/chat-ui/src/activity.ts
    symbol: groupDurationSeconds
---
`groupDurationSeconds` is the span of the group's timestamps; while the group grows it changes with every entry.