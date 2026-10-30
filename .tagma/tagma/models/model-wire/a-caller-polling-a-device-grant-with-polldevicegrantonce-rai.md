---
id: 01a0c86a-2d09-7bd1-a5e9-afc67992b85a
title: A caller polling a device grant with `pollDeviceGrantOnce` raises its own interval by `DEVICE_CODE_SLOW_DOWN_INCREMENT_MS` when the poll answers `slowDown`
ord: 24
tags: ["rule"]
sources:
  - kind: symbol
    ref: packages/llm/src/oauth/flows/deviceGrant.ts
    symbol: DeviceGrantPoll
  - kind: symbol
    ref: packages/llm/src/oauth/flows/deviceGrant.ts
    symbol: pollDeviceGrantOnce
---
The poll only reports `slowDown` as a flag; the interval belongs to the caller.