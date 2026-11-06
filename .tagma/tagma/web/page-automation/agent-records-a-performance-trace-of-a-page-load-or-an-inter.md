---
id: 01a18514-e6b1-7065-9cc4-fb7c178bcfc9
title: Agent records a performance trace of a page load or an interaction and reads its Core Web Vitals and DevTools insights
ord: 12
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-046726716824
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-0468add6b3fa
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/browser/Measuring.svelte
  - kind: file
    ref: apps/tagma/server/src/browser/contract/wire/traceOperations.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/analysis.worker.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/trace.ts
---
**Value.** An agent fixing a slow page proves where the time goes the way a developer does in DevTools: Core Web Vitals and DevTools' own insights as text, without a second browser or a Lighthouse run.

**How.** `trace_page` reloads the page under a trace, or starts one the agent ends after acting on the page; `read_page_trace` reads one insight in detail or the main thread's hottest functions.

**Behaviour.** Starting a trace requires fast input; saved trace analysis remains readable without running the page. A load stops on its own once the load event is followed by a short network quiet, or at the agent's deadline, saying whether the page settled. The answer gives, per navigation, LCP with its phases, INP and CLS where measured and each failed insight with its estimated saving, plus the conditions it ran under and whether Chromium dropped events. Insight names are DevTools' own (`LCPBreakdown`, `RenderBlocking`, `INPBreakdown`…). The file is a gzip trace Chrome DevTools opens; later reads answer from a saved analysis. A page holds one trace; a trace started by a thread stops and is analyzed when that thread's run ends. While it runs, the browser panel and the phone page view show who started it and for how long, with one Stop that ends and analyzes it. INP is the engine's high-percentile interaction; the insight also names the longest one when they differ.

**Limits.** The trace buffer is capped, so a long busy recording keeps its start and reports data loss. A trace whose page session was lost or taken by DevTools is gone with it. The first twenty insight sets of a trace are kept, and the ten newest traces of a page. The desktop path is proven by code, not by a run.
