---
id: 01a16e9c-5a6c-767e-836d-485bd509ce74
title: Measure the warm transport boundaries and remove desktop waiting and the shared inspection cost
ord: 38
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16ded-9161-7df7-9c19-57611b71ea05",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16b01-cb85-7e31-9936-47664dbd9a84
---
protocolRoad, protocolTransport and claudeConformance checked in one worker, forward and reverse, seeds 1–3: 14 passes and 93 assertions. Original shared sample: 34.7 s CPU; after lazy loading of the ACP fixture schemas: 29.7–35.7 s CPU, no proven A/B speedup; the Road body stays at 5.5–8.1 s, the ~3 s mark not reached. In desktop, acquisition, process-exit and progress waits replaced with facts, keeping the fallback poll of old releases. Own shared sample of four files: 18.0 s wall / 4.3 s CPU before and 16.8–17.9 / 4.8–5.2 after; speedup not proven. One review finding — a window opening after leave during a lease — reproduced red and fixed with lifetime to main; 26 SurfaceLoader cases pass individually on seeds 1–3. The provided inspection baseline is 6.7 s CPU each for test and integration. After: 35 unit, 302 tests, 2.3–2.5 s CPU; six resource files, nine passes, 4.8–5.5 s CPU. The previous four Ruff/Semgrep skips with unset artifact pins leave native conformance untested. Shared cold imports are being removed by the x-exec-a scripts; my own changes removed copy/bookkeeping assertions and moved the ESLint fixture into beforeAll. Changed tests checked individually on seeds 1–3, final bun run typecheck green. Profiles and all results recorded in x10/x-transport-b.tsv; the unit profiler's diagnostic failure fixed by its owner in b7f5ce2fe4, rerun passed.
