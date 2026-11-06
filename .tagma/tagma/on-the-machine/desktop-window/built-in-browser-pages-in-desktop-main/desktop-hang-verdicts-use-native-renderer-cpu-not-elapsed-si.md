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
Renderer probes and the beforeunload fence execute a constant expression in Electron's isolated world, so host maintenance does not run script in a page's main world. An attached debugger suppresses Electron's native unresponsive notification, so debugger probes and native hang notifications share the CDP CPU-budget primitive. Native responsiveness events omit the offending widget's identity and can belong to a child, so they only arm a fresh primary-frame request: the root CPU budget applies while that own request is unanswered, and only its same-process reply confirms recovery. While a debugger or a native root probe needs CPU, the host samples Electron's process counters once per cadence and joins each active page's native renderer PID with its process creation time. A qualifying request starts only after its first attributed CPU sample exists. Only cumulative CPU consumed by that same process while the request stays silent supports a verdict; descheduling and sleep do not spend it, and under the engine's CPU slowdown only the inverse of its factor of the sampled CPU counts, because Chromium's throttler spins the slowed thread rather than sleeping it. A missing counter or changed process identity leaves that flight waiting for its answer or end.

A scoped engine pause invalidates an in-flight verdict on its captured renderer before the pause starts, even when the lease begins and ends between CPU samples; that request then waits for its own answer or end. CPU membership follows the page's known native root and child renderers; during a pending navigation only the CPU slowdown's membership widens to the profile, while heap pause stays on its captured root renderer. Out-of-process engine sessions have no native PID attribution and do not infer a hang from silence.

A verdict belongs to the native renderer process that produced its CPU evidence: process replacement retires it, so recovery cannot spend the old verdict against the replacement. Reloading a page whose current renderer was proved unresponsive replaces that renderer and its engine session. Closing such a desktop page ends its renderer only when native frame and origin membership prove it unshared; otherwise it closes the target alone, preserving other pages and workers.
