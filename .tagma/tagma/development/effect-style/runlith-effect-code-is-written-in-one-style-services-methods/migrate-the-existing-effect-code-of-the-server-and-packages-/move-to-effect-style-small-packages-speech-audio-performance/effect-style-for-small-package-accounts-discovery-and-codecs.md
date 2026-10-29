---
id: 01a14c3a-41c2-7b42-8ad9-37b3b17d9f14
title: Effect style for small-package accounts, discovery and codecs
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c18-57a4-7e44-8b73-f191092d229d",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/adapter-anthropic/src/accounts.test.ts
  - kind: file
    ref: packages/agent-sources/src/sources.itest.ts
  - kind: file
    ref: packages/agent-zod/src/codec.test.ts
  - kind: file
    ref: packages/audio/src/testing/devices.test.ts
  - kind: file
    ref: packages/audio/src/testing/devices.ts
  - kind: file
    ref: packages/files/src/replace.itest.ts
  - kind: file
    ref: packages/utils/src/error.test.ts
  - kind: file
    ref: packages/utils/src/json.test.ts
---
Bring the tests and directly linked implementations of Anthropic, Kimi, xAI, Muse, agent-sources, agent-zod, files and utils to one Effect style; remove manual runners, use real scoped fixtures and fitting clocks with no change to public results. In audio, fix the released-capture observation at the test port: an interrupted reader leaves no open outcome, and a received Ended is kept. Proof is narrow typechecks, per-file public-contract checks and one Sol review of the delivery.
