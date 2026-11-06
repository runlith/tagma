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
A record's owner declares a form step with samples; a formed record is the step's fixed point. The owner declares `ThreadFormStep`, and composition gathers steps by name into a shared reader. The reader's `worker` starts the worker entry that builds that same reader, so another thread can decode with the same steps; a reader built without one cannot reach a worker. For each convertible record kind the step carries `samples` with the old form: the shared contract suite checks that a sample truly changes, the input does not mutate, and a repeated step returns `null` or the same form. The fixed point is needed because a record may already have passed the step on read or maintenance while the whole thread's mark still lags. A step also declares `back`, the forms that take its records to what the build before it reads (empty when that build reads the new form as it is), which a step back runs ([[50881cc3]]); the suite requires it of every step named after `20261105180000_ask_partial` and checks that each formed sample holds one of the texts its `back` declares in `holds`, and that its back is its own fixed point and forms into the same record again. The runtime applies the step to an issued record once; SQL paths that select records across many threads cannot change the step. The inbox body passes the same steps before decoding on every issue: an already-deferred signal must arrive in the current form, keeping the accepted message's id and state.
