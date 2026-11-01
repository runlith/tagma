---
id: 01a19556-0814-792b-ab3a-d8d1b4f42e09
title: Line-sliced landing carries an unrelated JSON manifest entry without its fixture
ord: 182
tags: ["reflection"]
fields:
  {
    "actual": "Commit fb333ef159 automatically carried the peer issue-4732-grid-flip entry in harness/manifest/own/browser.json, naming both peer holders, while leaving its untracked fixture outside HEAD.",
    "command": "submit_work call_af8eecfe2a4844bbad9720338b1ac9df",
    "expected": "Land the session's two own/browser entries and the explicitly selected suite/runner support, leaving the independent peer issue-4732-grid-flip manifest entry for its holder's delivery."
  }
---
Filed from project `vigla`. Received by a server up since 2026-11-01T02:51:04.711Z, from cb14a7909.

The call selected harness/manifest/own/browser.json but did not name it in whole or take either of its peer holders (01a19456-f0ed-7605-bb6e-6f8390049a99 and 01a19457-e130-796d-8f16-56fc8fa1a3c9). It explicitly took 01a19457-b6a8-74a7-bbef-aebc73a2a369 only for required browser.test.ts and the own/browser suite row in harness/src/suites.ts. The unrelated own/vite-plugin suite row was correctly left out. git show fb333ef159 confirms that the new browser manifest contains all three entries, while git status still shows harness/samples/own/browser/issue-4732-grid-flip/ untracked. Stores had explicitly requested leaving its row and fixture for its own delivery. The selected two scenarios were upstream-red/Vigla-green before submission; neither references the #4732 case.