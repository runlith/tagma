---
id: 01a1489c-3fa0-7f58-a16c-26316885f313
title: "Desktop learns a page hang under the debugger from its own probe: Electron's `unresponsive` event stays silent with a debugger attached"
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/desktop/src/browser/driven.ts
  - kind: file
    ref: apps/tagma/desktop/src/browser/host.ts
  - kind: file
    ref: apps/tagma/desktop/src/browser/page.ts
  - kind: file
    ref: apps/tagma/desktop/src/browser/strain.ts
---
While the debugger is attached, Electron sends no `unresponsive` for a hung renderer — and it is under the agent that a hang must be noticed, so the core refuses `page-unresponsive` and can reload the page. A one-second probe sends a light `Runtime.evaluate`; no reply past the threshold and the host reports `unresponsive`, a reply and it reports `responsive`. The threshold is the managed host's, so one page on two hosts gets one verdict.

A scoped strain hold excludes an engine-owned pause from an in-flight probe's elapsed time and divides active time by the strongest held CPU slowdown. Desktop watchdogs consult their current renderer's aggregate. CPU membership follows the requested page's known native root and child-frame renderers. During a pending document navigation the speculative renderer cannot be joined from CDP to Electron, so only its CPU factor temporarily reaches the profile; commit or failure returns to exact membership once no navigation remains pending. If a native event cannot identify its frame, the fallback remains until loading stops. Native frame listeners belong to the CPU lease and end with it. Heap pause stays on its captured root renderer through navigation, and releasing any lease preserves the others. Native Electron hang notifications use the same scaling without a debugger; CPU strain delays a hang verdict rather than suppressing it.

The probe stands in the renderer's queue behind the agent's own commands, so a long command without a strain hold (an accessibility-tree snapshot of a very large page) is indistinguishable from outside from a hang; the decision is the core's — task [[475a615c]].

Reloading a hung page drops the renderer: the previous CDP session on it is dead, so the host closes it (`swap`) and reports `swapped`, and the core connects anew. This deliberate renderer failure is not reported as `crashed`.

Closing a page the host holds hung ends its renderer first, then closes on the process's end, which is reported as `crashed`. Closing alone leaves Chromium to retire the process at its own pace, and a fresh same-site page can land in it. A renderer that another page or frame uses, or that hosts the origin of another page or frame, is only closed: ending it would end those pages, or a shared or service worker living in it that serves a same-origin client from another process. Worker clients are always same-origin, and main sees every frame of the app, so these two checks together prove a renderer unshared.
