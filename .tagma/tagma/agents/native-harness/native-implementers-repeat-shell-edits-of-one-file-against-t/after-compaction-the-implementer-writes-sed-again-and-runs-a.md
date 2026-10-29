---
id: 01a12038-506f-782b-a6ba-76db7b597ac9
title: After compaction the implementer writes sed again and runs a check outside the issued slot
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "After compaction the implementer ran sed -i and a non-canonical tsc with no slot/lock; grep/head hid the overall result. The lead interrupted the run and stopped command 4b3e17f8-a786-4bde-b138-128561f4c0cb:146, exit 130 received. Already-written bytes are preserved.",
    "command": "impl-terminal-delivery: sed -i '' 's/void_/empty/g' terminalDelivery.stest.ts && timeout 50 bunx tsc --noEmit -p . | grep -i terminalDelivery | head",
    "expected": "The direct task and the compaction keep survive: sources change via file tools, checks only after the lead's slot under the shared lock, with the canonical server compiler and the full result."
  }
---
Filed from project `runlith`.
