---
id: 01a14c2e-4cb8-74f7-a4b1-5db3a8327d0a
title: Bring the LLM quota and transport tests to Effect style
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c18-57a4-7e44-8b73-f191092d229d",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/builtin-catalog/src/core/ProviderSignIn.test.ts
  - kind: file
    ref: packages/llm/src/llm/route/executor.test.ts
  - kind: file
    ref: packages/llm/src/llm/route/transport/connect.test.ts
  - kind: file
    ref: packages/llm/src/llm/route/wireFailure.test.ts
  - kind: file
    ref: packages/llm/src/llm/schema/quota.test.ts
  - kind: file
    ref: packages/llm/src/llm/schema/quota.ts
  - kind: file
    ref: packages/llm/src/oauth/flows/deviceGrant.test.ts
  - kind: file
    ref: packages/llm/src/oauth/flows/deviceGrant.ts
  - kind: file
    ref: packages/llm/src/oauth/ProviderSignIn.ts
---
Finish the manual migration of the remaining LLM parts: internal quota errors are separated from their wire schema, time comes from Clock, test functions use Effect.fn with no loss of optional parameters and request scopes. Keep wire quota and transport behaviour; proof is a narrow bun check, the touched owners' tests and one independent Sol review.
