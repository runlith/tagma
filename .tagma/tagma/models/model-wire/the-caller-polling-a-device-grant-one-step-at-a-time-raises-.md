---
id: 01a0c86a-2d09-7bd1-a5e9-afc67992b85a
title: The caller polling a device grant one step at a time raises the interval itself on slow_down
ord: 24
tags: ["rule"]
sources:
  - kind: dir
    ref: packages/llm/src/oauth/flows
  - kind: symbol
    ref: packages/llm/src/oauth/flows/deviceGrant.ts
    symbol: DeviceGrantPoll
  - kind: symbol
    ref: packages/llm/src/oauth/flows/deviceGrant.ts
    symbol: pollDeviceGrantOnce
---
