---
id: 01a14c05-9e90-75d0-ab7c-5811b9543dcc
title: A diagnostic report collects over chosen time via CLI and opens apart from the user's installation
ord: 7
tags: ["feature"]
fields:
  {
    "state": "promised"
  }
edges:
  - kind: relates
    to: 01a136c1-4ec1-7395-bc66-acdb0a20e25b
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2b00fb170e3
  - kind: relates
    to: 01a14c05-9e90-75d0-ab7c-580f84a0bdd4
sources:
  - kind: file
    ref: apps/tagma/desktop/src/report.ts
  - kind: file
    ref: apps/tagma/server/src/cli/verbs.ts
  - kind: file
    ref: apps/tagma/server/src/performance/reads.ts
  - kind: file
    ref: packages/performance/src/protocol/queries.ts
---
**Value.** The user must collect diagnostics for the needed time from the terminal, and a developer must open the received report with the same readings, without access to the user's installation.

**How.** In the self-observation spec, a promised `tagma report` with a window-start choice and a source file for diagnostic readings.

**Behaviour.** The target scenario carries the problem's chosen evidence in one archive, which the developer takes apart outside the user's live server.

**Limits.** State: promised — the report CLI verb is not declared, and the performance query does not take a ZIP as a source. Reading another execution host's state catalog already works, but it reads its ring and does not open a desktop archive. The existing desktop export does not pick a time interval.
