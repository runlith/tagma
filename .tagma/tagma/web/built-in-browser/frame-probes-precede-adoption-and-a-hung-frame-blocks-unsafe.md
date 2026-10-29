---
id: 01a18452-e33b-7115-849c-cb5b114b448e
title: Frame probes precede adoption, and a hung frame blocks unsafe in-place recovery
ord: 10
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/contract/service/pages.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/automation.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/drive.ts
  - kind: file
    ref: apps/tagma/server/src/browser/pages.ts
  - kind: file
    ref: apps/tagma/server/src/managed-browser/targets.ts
---
Other-process frames have their own renderer queues, so a main-frame reply proves nothing about them. The engine starts each frame probe before enabling domains; the page-state owner aggregates its verdict with the host's main-frame verdict and clears it when the child-session scope ends. The recovery exemption applies only to a main-renderer failure known at entry; a failure first discovered during attachment still interrupts the call. A late-attached debugger may not control an already-hung renderer, and that renderer may serve other pages: in-place reload refuses rather than attach debuggers before scripts run or terminate a shared process. The managed host may end a main-frame-unresponsive renderer during close when its main session stays silent for a fresh unresponsive interval while fresh successful probes of the profile's other page and iframe targets prove it unshared. It rechecks eligibility after waiting and waits for Chromium's crash notification before releasing the page. If that proof is unavailable, recovery uses another profile or waits for the profile browser to end; reopening before that can reuse the same hung renderer. Guidance names live same-profile pages and their opening threads or non-thread origins, so agents close only their own pages and ask the operator about the rest.