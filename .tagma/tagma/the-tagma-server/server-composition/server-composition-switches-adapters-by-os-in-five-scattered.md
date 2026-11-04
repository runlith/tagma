---
id: 01a1a76d-606c-754b-8ffb-fa70ba68a763
title: Server composition switches adapters by OS in five scattered places and hardcodes a dylib name
ord: 50
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a0eaa1-2c4c-7cbd-9014-d7496f758080
  - kind: relates
    to: 01a19ec6-f467-787a-a87e-89cb77c57d56
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/server.ts
  - kind: file
    ref: apps/tagma/server/src/composition/editors.ts
  - kind: file
    ref: apps/tagma/server/src/composition/speech.ts
  - kind: file
    ref: apps/tagma/server/src/composition/browser.ts
  - kind: file
    ref: apps/tagma/server/src/composition/children.ts
---
Composition is where an adapter may be chosen by OS, but here five files each make their own `process.platform` choice instead of one platform switch, and two carry behaviour beyond the choice.

Read at ee24295b8e:
- `composition/server.ts:201` the macOS user shell or none.
- `composition/speech.ts:76-81` the macOS audio helper channel or `AudioDevices.none`.
- `composition/browser.ts:84` cookie sources on darwin only, empty elsewhere.
- `composition/editors.ts:16-28` macOS editors on darwin; otherwise PATH editors with the JetBrains Toolbox directory computed by win32 or Unix (`:16-18`) and the opener program `explorer.exe` or `xdg-open` (`:28`). This is behaviour, not choice.
- `composition/children.ts:31` a checkout's process-reader path is the literal `libexecution_platform.dylib`; the bundle branch beside it (`:26`) only compares values and is fine.
- `apps/tagma/server/src/power/power.ts:22` passes `process.platform` into the sleep facility; it stands in the Machine power task.

Done when one platform composition picks every OS adapter, holds no logic beyond the choice, takes library names from the adapter's artifact, and a Linux runner boots the composition with the adapters' none-fillers.