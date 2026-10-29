---
id: 01a11cda-1a03-75a1-9a34-e724e9d8b03c
title: A record's owner declares a form step with samples; a formed record is the step's fixed point
ord: 4
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a11caa-42ff-703c-82f5-4128b0dc848c
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/formContracts.test.ts
  - kind: file
    ref: packages/agent/src/transcript/kinds.ts
---
A record's owner declares a form step with samples; a formed record is the step's fixed point. The owner declares `ThreadFormStep`, and composition gathers steps by name into a shared reader. For each convertible record kind the step carries `samples` with the old form: the shared contract suite checks that a sample truly changes, the input does not mutate, and a repeated step returns `null` or the same form. The fixed point is needed because a record may already have passed the step on read or maintenance while the whole thread's mark still lags. The runtime applies the step to an issued record once; SQL paths that select records across many threads cannot change the step. The inbox body passes the same steps before decoding on every issue: an already-deferred signal must arrive in the current form, keeping the accepted message's id and state.
