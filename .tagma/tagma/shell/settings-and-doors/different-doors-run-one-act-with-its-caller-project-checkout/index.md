---
id: 01a14c05-9e8f-7c75-a633-b2ad5afaf792
title: Different doors run one act with its caller, project, checkout and explainable refusal
ord: 5
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-927fda029bcc
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-694ce885261c
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2abc2918809
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2ac8ddf7b0e
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/http/operations.ts
  - kind: file
    ref: apps/tagma/server/src/invocation/admission/callers.ts
  - kind: file
    ref: apps/tagma/server/src/invocation/admission/place.ts
  - kind: file
    ref: apps/tagma/server/src/invocation/admission/project.ts
  - kind: file
    ref: apps/tagma/server/src/invocation/nativeDoor.ts
  - kind: file
    ref: apps/tagma/server/src/invocation/perform.ts
  - kind: file
    ref: apps/tagma/server/src/platform/contract/wire/refusal.ts
---
**Value.** The operator, agent and external client run one product act with its conditions and get an explainable refusal regardless of transport.

**How.** The `/api/op/:id` HTTP door, declared socket doors and native tools; transport hands the call to a shared `invocation`.

**Behaviour.** The call tells apart who acts and the place of the act. The project may be named explicitly; an operation's subject or a file refines the checkout, and a contradicting explicit project is not silently swapped. The thread's home does not change from this. Resolved block names are cached separately per graph copy: both preparation and execution through any door get ids of its mirror. A repeated search within the same copy uses its cache. The shared path checks the caller, prepares the act and applies its approval conditions. A refusal preserves the reason and ways to proceed; an inner failure has a different outcome. HTTP adds pictures only on the client's explicit request.

**Limits.** An operation is reachable only in its declared door and for declared callers; a tool record and the right to call are different properties. An unreadable graph does not by itself close the project's chats. Law delivery, thread powers and the subject result are owned by their owners.
