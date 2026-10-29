---
id: 01a14c48-0ee6-720a-9e9b-ab3b3eddc4a9
title: Finish migrating the built-in catalog and remaining OpenAI profiles
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c18-57a4-7e44-8b73-f191092d229d",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13b37-5351-7e3a-bda9-f7bf25d19486
sources:
  - kind: file
    ref: packages/adapter-openai/src/accounts.test.ts
  - kind: file
    ref: packages/adapter-openai/src/oauth/flows/openai.test.ts
  - kind: file
    ref: packages/adapter-openai/src/profiles/codexWeb.test.ts
  - kind: file
    ref: packages/adapter-openai/src/profiles/codexWeb.ts
  - kind: file
    ref: packages/adapter-openai/src/profiles/openai.test.ts
  - kind: file
    ref: packages/adapter-opencode-go/src/profiles/opencodeGo.ts
  - kind: file
    ref: packages/builtin-catalog/src/core/anthropic-messages.test.ts
  - kind: file
    ref: packages/builtin-catalog/src/core/FileTokenStore.itest.ts
  - kind: file
    ref: packages/builtin-catalog/src/core/openai-chat.test.ts
  - kind: file
    ref: packages/builtin-catalog/src/core/openai-responses.test.ts
  - kind: file
    ref: packages/builtin-catalog/src/core/resolve.test.ts
  - kind: file
    ref: packages/builtin-catalog/src/subscription/provider.ts
---
Migrate the remaining owner tests of the built-in catalog and OpenAI, web-search retry and OpenCode Go to the current Effect 4. Keep vendor request shape and typed failures, verify narrow types and the changed tests, Effect-style, and assess the whole delivery with one independent review.
