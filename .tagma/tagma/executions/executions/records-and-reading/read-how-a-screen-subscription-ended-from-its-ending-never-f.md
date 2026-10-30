---
id: 01a0c70a-844f-73b2-b3c3-9240823dea61
title: Read how a screen subscription ended from its `ending`, never from the words of `reason` or `detail`
ord: 2
tags: ["rule"]
sources:
  - kind: symbol
    ref: packages/executions/src/protocol/presentation.ts
    symbol: ScreenSubscriptionEnding
  - kind: symbol
    ref: packages/executions/src/protocol/presentation.ts
    symbol: ScreenUnavailable
---
In `ScreenUnavailable`, `reason` names the stage and `detail` is a phrase for people. Only `ending` (`completed | cancelled | gap | unavailable | closed`) reports the outcome; without it the outcome is unknown.