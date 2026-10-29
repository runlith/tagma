---
id: 01a12c8b-1b76-72c8-9478-43e6405b51ee
title: CLI threads new refuses with Expected JSON value on optional fields
ord: 7
tags: ["reflection"]
fields:
  {
    "actual": "The CLI exited 1 with Expected JSON value before the request. threadVerbs.ts passes type, host, and scopeName with undefined in the payload.",
    "command": "TAGMA_SERVER_URL=http://127.0.0.1:18531 bun cli/main.js threads new --project 2 --title activity-probe --json",
    "expected": "Create an idle thread on a separate trial server and return JSON."
  }
---
Filed from project `runlith`.
