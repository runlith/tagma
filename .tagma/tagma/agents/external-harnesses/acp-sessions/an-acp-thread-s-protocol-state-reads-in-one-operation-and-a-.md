---
id: 01a15bb3-3312-7bbd-a37c-bb28a88e9474
title: An ACP thread's protocol state reads in one operation, and a hanging request's age comes from the driver row mark, not the client machine
ord: 10
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/contract/wire/protocolState.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/diagnosis.ts
---
`read_harness_protocol` gathers in one answer what used to take searching serve.log, SQLite and the execution record:
- the session and its owner;
- the runner execution and whether the installation holds it;
- the stdout parse cursor against the execution record's `durableThrough`;
- Tagma's unanswered requests to the agent, and the agent's unanswered questions;
- the row's turns and its failure;
- the last drive failure on this server.

A gap between `parsed` and `written` means the driver never took the runner's output. An old request in `requests` means the agent never answered.

The ACP client machine keeps no clock: it is deterministic, and re-reading from a cursor must yield the same result. So a request's time is the driver row's `sent` field. `ProtocolSteps.saved` sets it when the request first enters the saved row and clears it when the request leaves. The mark is set before frames are written to stdin, so age counts from when the request is recorded, not when the bytes left. Only a request absent from the row before this step gets the mark. A request from a row saved before the field existed stays timeless through later writes: otherwise an old unanswered request would look just sent. Reading a non-`acp` thread refuses with `protocol-unavailable`.

The last drive failure lives in this server's watch memory until the session ends. After a restart it is gone; the cause is kept by the run activity's `dropped` note and the error list.
