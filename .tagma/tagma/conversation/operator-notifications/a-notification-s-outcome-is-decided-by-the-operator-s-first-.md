---
id: 01a12355-d36d-7240-902c-ae3428069dc6
title: A notification's outcome is decided by the operator's first act and reaches the sender at least once, until the sender takes it
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/notify/handback.ts
  - kind: file
    ref: apps/tagma/server/src/notify/inbox.ts
---
An answer and a dismissal write the outcome with one conditional update (`ended_at IS NULL`), so of two competing acts — answering from the phone and dismissing on desktop — the first decides the outcome, and the second gets the same outcome with `repeated: true`, not a refusal. The record stays in the table after that too: delivery to the sender goes through the `Outcomes` port, and until the port takes the outcome, `Handback` retries with a growing pause up to an hour; on server start undelivered outcomes are picked up again. So the receiver must be idempotent on the notification id. Writing the outcome, taking it off "Attention" and starting delivery run as one indivisible step: a call break between them would leave an outcome nobody learns of until the next server start. Closed records live a week from the outcome, delivered or not: a plugin that's gone doesn't hold them forever. The module's own tier starts the cleanup: at start and then hourly.

What the operator sees is another matter: an open notification leaves "Attention" and push at the outcome moment, without waiting on delivery. Push sends only the `/?notification=<id>` link and the question text; the answer itself arrives through `answer_notification`, not from push.
