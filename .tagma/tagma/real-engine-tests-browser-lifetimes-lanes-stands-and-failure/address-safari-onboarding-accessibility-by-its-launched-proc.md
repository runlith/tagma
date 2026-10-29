---
id: 01a18497-aa6f-727a-8975-5629115e28fc
title: Address Safari onboarding accessibility by its launched process
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18358-6882-7146-96af-279f8f0fbb3e",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a18353-faf9-7ec5-8d39-1590cc47fdde
  - kind: relates
    to: 01a18456-7235-7c5f-b458-64abcdc59b7d
---
Fix the native lane setup failure reported by held-driver: after Simulator boot completes, the window-server frontmost query can return no application despite Safari having a launch identity. Retain that PID for onboarding accessibility and quiescence, preserving real native taps and failing on actual target loss rather than retrying discovery. Verify through the reported packages/chat-ui/stand/native.e2e.ts caller.

Landed in cbc22b80b1 with two more lane defects that caller exposed. The blocking search-engine alert belongs to SpringBoard, so onboarding reads both PIDs. A quiet wait right after launch can meet idb's applicationNotResponding, which idb itself rates safe while the app's accessibility server starts. The pinned execute_script atom turned undefined properties into null, so page values now cross as a checked copy that refuses what JSON would change. The real caller now passes setup and transfer: 36 assertions, then a failure inside the stand's own momentum calibration, owned by feed-stand. packages/e2e/src/lanes/ios.e2e.ts passes on iOS 26 with 30 assertions (report run.63836.1793228570071.jsonl).