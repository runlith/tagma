---
id: 01a10482-8180-7bcc-bfee-fd5500577523
title: Make word delivery to an idle third-party CLI once-only and honest
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a10477-c44b-7404-834c-6f656bc97365",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a10482-425d-73da-8cef-d68ca6cf58e6
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/sessions/keyboard.ts
---
Fix word delivery to an idle third-party CLI:
- Enter under a fresh input-profile revision;
- a typed host refusal on profile conflict instead of "no interpreted screen";
- an honest "delivered, acceptance unconfirmed" answer instead of a refusal after partial typing;
- acceptance confirmation via `UserPromptSubmit`;
- once-only redelivery if the execution changed before confirmation;
- establish who replaced execution 108 → 109.

The whole model, boundaries and check are in the spec.

Start with: `external-harnesses/sessions/keyboard.ts` (`typeHarnessWords`, `admits`), `sessions/drive.ts` (`receive`, `type`), `packages/execution-host/src/{Execution,Interpretation,InputModes,refusals}.ts`, `external-harnesses/adapter/claudeFormat.ts`, `turns/deliveries.ts`, `hooks/dispatch.ts`.

Done when spec check items 1–5 pass, and item 6 is described as an operator step after a server restart. Live check: after installing the build and a server restart by the operator himself, open an idle Claude Code, call send_message once with a unique word; check the acceptance answer and Claude's answer with the same word. Do not resend before confirmation. The working server and cc-probe were neither restarted nor given input during implementation.
