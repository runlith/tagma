---
id: 01a0c465-d3bc-7b64-91a4-961f1fe78496
title: Extend invocation visibility and control to external harness tool calls
ord: 3
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0c3c3-7916-729c-a148-d546b2793096
  - kind: implements
    to: 01a0c3c3-5cae-7cce-af4b-00c64ef45bc7
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/serving.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/contract/service/sessions.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/observations/admission.ts
---
The new call owner is wired through the native AgentToolDoor; tools executed inside foreign CLIs do not enter that lifecycle. Read each harness adapter's actual events and per-tool control capabilities, then connect its invocations to the same project-visible activity and controls. A per-tool stop must not be emulated by killing the whole CLI run, and unsupported control must remain explicit rather than being reported as success.