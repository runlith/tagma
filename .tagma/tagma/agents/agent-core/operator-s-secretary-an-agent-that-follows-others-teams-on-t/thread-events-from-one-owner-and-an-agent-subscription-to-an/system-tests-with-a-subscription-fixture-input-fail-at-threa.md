---
id: 01a164a9-5615-75f9-b449-c45da902c1ee
title: "System tests with a subscription fixture input fail at thread birth: unknown-account \"fixture-account\" for openai-oauth"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a164a9-7e22-76bc-b03b-4579038bcd0c",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16449-f3a3-7a52-9c4a-90515fc6ae4f
---
The fixture places a subscription token input (`world.runtime.tokens.add('subscription', … account: 'fixture-account')`), while thread birth (`threads/birth/acts.ts` → `providers/contract/service/accounts.ts:70`) looks that account up at `openai-oauth` and refuses. All 7 tests in `composition/testing/http/collaborationDoor.stest.ts` fail (verified 2026-10-22 ~19:30), plus `birthPlace.stest.ts`, `teamPlaces.stest.ts`, `lifeScale.itest.ts` (`no-model-connected`). This leaves end-to-end subscription delivery and subscription in `spawn_agent` unproven. Suspicion of `6faef5f652` did not hold: that commit is from October 19, and the tests passed later.
