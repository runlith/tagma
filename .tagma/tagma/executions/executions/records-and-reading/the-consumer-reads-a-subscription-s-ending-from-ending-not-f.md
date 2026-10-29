---
id: 01a0c70a-844f-73b2-b3c3-9240823dea61
title: The consumer reads a subscription's ending from `ending`, not from words in `detail`
ord: 2
tags: ["rule"]
sources:
  - kind: file
    ref: packages/executions/src/protocol/appearance.ts
  - kind: file
    ref: packages/executions/src/protocol/presentation.ts
  - kind: symbol
    ref: packages/executions/src/protocol/presentation.ts
    symbol: ScreenSubscriptionEnding
  - kind: symbol
    ref: packages/executions/src/protocol/presentation.ts
    symbol: ScreenUnavailable
---
In `ScreenUnavailable`, reason names the stage, detail is a human phrase. Only ending (`completed | cancelled | gap | unavailable | closed`) reports the outcome; without it the outcome is unknown.
