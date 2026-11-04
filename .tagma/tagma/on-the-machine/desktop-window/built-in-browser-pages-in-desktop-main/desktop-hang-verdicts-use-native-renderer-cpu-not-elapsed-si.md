---
id: 01a1489c-3fa0-7f58-a16c-26316885f313
title: Desktop hang verdicts use native renderer CPU, not elapsed silence
ord: 2
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a1a76a-aaa8-7eed-9b33-f9a8e85431e9
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
An attached debugger suppresses Electron's native unresponsive notification, so debugger probes and native hang notifications share the CDP CPU-budget primitive. The host samples Electron's process counters once per cadence and joins each page's native renderer PID with its process creation time. Only cumulative CPU consumed by that same process while the request stays silent supports a verdict; descheduling, sleep and CPU throttling do not spend it. A missing counter or changed process identity leaves that flight waiting for its answer or end.

A scoped engine pause invalidates an in-flight verdict on its captured renderer before the pause starts, even when the lease begins and ends between CPU samples; that request then waits for its own answer or end. CPU membership follows the page's known native root and child renderers; during a pending navigation only the CPU slowdown's membership widens to the profile, while heap pause stays on its captured root renderer. Out-of-process engine sessions have no native PID attribution and do not infer a hang from silence.

Reloading a page whose renderer was proved unresponsive replaces its renderer and engine session. Closing such a desktop page ends its renderer only when native frame and origin membership prove it unshared; otherwise it closes the target alone, preserving other pages and workers.
