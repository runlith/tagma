---
id: 01a0d62c-eae3-7dbd-afc0-270fbda92239
title: "Unit tests that wait on the clock past the 1 s unit limit: Soniox's client, Devin's truncated body, the event-loop compiler check and two host replacements"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0de0b-e6ab-7936-871e-6bc654696615",
    "status": "done"
  }
---
The unit layer's per-test limit is 1 s ([[8e7c936b]], set by `test/layers.ts`). These tests wait on real time and fail at it:
- `packages/transcription-soniox/src/index.test.ts`: five `createSoniox` tests wait out real delays (one sleeps 1.1 s for the idle keep-alive);
- `packages/llm/src/llm/protocols/devin.test.ts`: "fails a captured body truncated before its Connect trailer";
- `apps/tagma/server/src/enforcement/eventLoop.test.ts`: "the server and the CLI load no TypeScript compiler …" (it also loads workers);
- `apps/tagma/server/src/terminals/hostReplacement.test.ts`: two tests that wait on a stop ladder.

For each: drive the clock (Effect's `TestClock`, an injected delay), declare the test's own limit as `test`'s third argument where the wait is the subject, or move it to `.itest.ts` if it reaches a real resource. Done when none of them is listed in `test/failing.json`.