---
id: 01a11e54-f0ff-7362-a305-8a62a94baa59
title: Terminal launch delivery survives failure after bytes and recovery before launch
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a11c9a-6edb-7ed8-b517-60b0a621fbb3
---
Fix the confirmed terminal-review defects in `terminal/runs.ts` and `terminal/words.ts`: after a possible PTY write, words must not return as LaunchFailed; adopt restores core-open-before-launch and a proven unsent intention, but never repeats unknown. The persisted send-state declaration, its migration, and all consumers change in one cut; RunReports.lapsed stays with a separate core owner. Proof is the public launch/adopt with refused, written, and unknown receipts, failure after bytes and rebuild; one actual input and the correct inbox fate. The implementation is recorded in `78f9c0e230`, the wake fix after launch refusal in `e12f44b466`. Public launch/adopt cover refused, written, and unknown; real SpawnFailed is proven by a negative control and the passing case "one word → two failed attempts → launchBlocked". A write failure after PTY open is checked via a SQL refusal; loss of the HTTP response was not reproduced separately.
