---
id: 01a128be-f59d-7c30-8434-2c534727a7a6
title: An app-side operation input crosses JSON without keys holding undefined
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a128b8-870b-7f4c-b76d-0596da89f514",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12812-89b3-78cf-8d61-fdf662f24a1d
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/wire/operation.ts
---
A red `http: Expected JSON value` banner when starting a Codex thread from the new-thread screen and when sending with a PNG in a native thread (build 20261011T020137440Z).

Root: `operationPayload` in `apps/tagma/app/src/lib/wire/operation.ts` encodes the operation input with a typed codec, and after the conditional-spread cleanup (62f24a1d, commit `04585e3984`) it keeps keys holding `undefined`. The `perform` body is declared `Schema.Unknown`, the `HttpApiClient` encodes it with the Effect JSON codec (`Unknown` → `Json`), and `{ x: undefined }` is no JSON value: the request fails in the client and never reaches the server, so the server log has none of it.

Fix at the owner: the operation input crosses JSON like the server answer (`answerJson` in `invocation`): an `undefined` object member is dropped. Crossing into JSON moves to `toJson` from `@runlith/utils/json` and serves both directions. The schema JSON codec on the client is rejected: `toCodecJson` writes `undefined` on `Schema.optional(Schema.NullOr(X))` as `null`, and the server would take "unset" for "clear" (`set_thread_model.account`).

Done in `14230e63a5`. No live repeat on its own instance: the request failed in the client and never reached the server, so the repeat is a `Door.test.ts` test through the real `HttpApiClient` (before the fix — exactly `http: Expected JSON value`). Sending with a PNG in a native thread did not reproduce from the log: both of the operator's thread attachments uploaded at 04:08 local time, and the messages arrived.

Done when `Door.perform` with `x: undefined` sends the body with no key (the test in `Door.test.ts`, red before the fix), and typecheck and the `app`, `utils`, `invocation` tests are green.
