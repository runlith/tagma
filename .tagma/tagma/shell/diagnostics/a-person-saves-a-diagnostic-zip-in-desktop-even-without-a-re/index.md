---
id: 01a14c05-9e90-75d0-ab7c-580f84a0bdd4
title: A person saves a diagnostic ZIP in desktop even without a responding server
ord: 5
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a136c1-4ec1-7395-bc66-acdb0a20e25b
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2abc2918809
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2b00fb170e3
sources:
  - kind: file
    ref: apps/tagma/desktop/src/quitting.ts
  - kind: file
    ref: apps/tagma/desktop/src/report.ts
  - kind: file
    ref: apps/tagma/desktop/src/waitingPage.ts
  - kind: symbol
    ref: apps/tagma/desktop/src/main.ts
    symbol: reportProblem
---
**Value.** A person saves evidence of a problem as one file and hands it to the developer themselves, even if the server stopped responding.

**How.** Help → Report a Problem in desktop, plus actions from errors and the waiting page. Composition and approximate size are shown before saving.

**Behaviour.** Desktop collects a ZIP from local files: build and machine info, tails of the launch/restart log and server log, and when present — the last performance segment with WAL. No server answer is needed for this chain. The archive is never sent anywhere automatically.

**Limits.** This door does not exist in the browser app. The current export takes the last segment, not an arbitrary time window or the whole ring; copying files is not a consistent SQLite snapshot. Log and segment are copied unfiltered, so the promise to reliably exclude texts and secrets from the report is not proven by code. Repeat recording, CLI export, and direct parsing of the ZIP by diagnostic reads are still separate promises.
