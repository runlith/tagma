---
id: 01a1a76d-5ffe-7ec0-bb68-f06a60a95598
title: The model wire opens the browser with an OS-specific command chosen in shared OAuth code
ord: 64
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a0eaa1-2c4c-7cbd-9014-d7496f758080
  - kind: relates
    to: 01a19ec6-f467-787a-a87e-89cb77c57d56
sources:
  - kind: file
    ref: packages/llm/src/oauth/flows/open-browser.ts
---
The default OAuth flow launches the system browser itself and picks `open`, `cmd /c start` or `xdg-open` by `process.platform`. The same open-with-the-OS mechanism also stands in `apps/tagma/server/src/installation/cli/server.ts:161`, `apps/tagma/server/src/composition/editors.ts` and `apps/tagma/server/src/checkout-files/reveal/files.ts`.

Read at ee24295b8e:
- `packages/llm/src/oauth/flows/open-browser.ts:2-4` the three commands by platform.

Done when the flow asks an injected opener, the per-OS launcher is one adapter shared with the other openers, and the module's tests pass on a Linux runner.