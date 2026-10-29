---
id: 01a13ba3-4133-72cf-9164-0a87beebfc35
title: Hand-written _tag extends Error classes become Data.TaggedError, and the effect-style check blocks new ones
ord: 14
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13ba3-7d49-734f-b893-d6f39dd3b824",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13b37-5351-7e3a-bda9-f7c22e414755
  - kind: relates
    to: 01a13b76-3d46-78eb-b352-1c3901ba3d55
---
41 classes in 24 files (`apps/tagma/server/src`, `apps/tagma/inspection`, `packages`, no tests and no `archive/`) are declared as `extends Error` with a hand-written `_tag` field: a home-made `Data.TaggedError` whose tag can drift from the class name (as it already does in the `packages/agent` stores). `extends Error` without `_tag` stays for synchronous throw outside Effect and for defects.

Do: move these classes to `Data.TaggedError` with the same tag consumers see (`catchTag`, `_tag` checks, wire projections) — a tag may change only together with all its readers. Add an `extends Error` with `_tag` shape to `checks/law/effect-style` and enable it under the Data.TaggedError rule through enforce_law. Result: 41 classes moved in `e3ae146a5a`, original tags, names, payloads and spans kept. The `native-tagged-error` shape enabled through enforce_law; constructor parameter properties added after review in `35db0e78a4`. Changed source files are clean on error shapes. 238 server/llm/utils/checker tests and 913 agent tests checked; three agent-run timeouts passed narrowly. Sol xhigh and Muse xhigh reviews done, Sol's remark fixed. Typecheck of checker, llm and utils passed; full agent/server typecheck stayed unproven because of others' unfinished tests (`agentSkillRequests.test.ts`, `providerTransitions.itest.ts`, `models/client.itest.ts`). Two native-tagged-error fixtures in `utils/error.test.ts` and `utils/json.test.ts` remain: they check an arbitrary native Error with a tag and a non-enumerable message; enforcement names them as escaped.
