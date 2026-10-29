---
id: 01a0d62c-eaf9-77b7-bafc-20256545ac56
title: "Seven unit files spend more than the 1.5 s processor budget: the three boundary scans, the image normalizer, the operations table, the event-loop check and the accepted Claude profile"
ord: 14
tags: ["task"]
fields:
  {
    "status": "closed"
  }
---
The unit budget is 1.5 s of processor time per file ([[8e7c936b]]; derived from the pure files' p99 of 1470 ms on 2026-09-24). Measured past it on 2026-09-25:
- `apps/tagma/server/src/boundary.test.ts` 3496 ms — still open;
- `apps/tagma/server/src/enforcement/eventLoop.test.ts` 3553 ms — resolved: moved to the integration layer as `eventLoop.itest.ts` (`3deb882086`);
- `apps/tagma/server/src/protocol/operations.test.ts` 1957 ms — resolved: reads the tree once and looks refusal codes up in a set (`72a12d3645`);
- `packages/llm/src/boundary.test.ts` 2212 ms — still open;
- `packages/llm/src/capture/claudeAcceptedProfile.test.ts` 1619 ms — lightened by `42dc6d32b4` (corpora decode once at file load), unmeasured since;
- `packages/llm/src/models/normalizeModelImage.test.ts` 4126 ms — lightened by `42dc6d32b4`, unmeasured since.

`test/failing.json`, which carried the five still-open entries, was deleted (`585eb16d7d`) under [[93739392]] — no list of failing tests is kept — so standing over-budget files are tracked here, not there. The boundary scans read and parse the whole package's imports; once `@runlith/code-facts` caches import facts ([[ae56a980]] §5) they should read them instead. The others do real work a unit test may not need at that size. Done when each file is under the budget, or the operator sets the budget above it.