---
id: 01a156e2-5086-7580-8641-f925fe55947f
title: A trial instance does not rewrite integrations in registered checkouts
ord: 84
tags: ["task"]
fields:
  {
    "holder": "tagma:01a156e1-0024-75f9-aab2-3f2639ccf5ae",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a156e0-50e8-75ab-92c6-45be3fa106f0
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/cut/beside.ts
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/installs/upgrade.ts
    symbol: refreshInstallations
---
A beside launch declares the install mode in the environment and launcher; refreshInstallations and declaredForLaunch skip writes to checkouts, the main mode updates law and MCP. 13 affected integration tests passed, independent review with no findings. Full bun run typecheck done: 7 TS2345 in the unrelated native-harness/voice/graphDisplay.test.ts (optional facts.value vs string), no errors in the changed files.
