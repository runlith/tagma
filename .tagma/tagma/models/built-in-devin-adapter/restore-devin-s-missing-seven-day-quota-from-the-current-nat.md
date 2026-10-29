---
id: 01a0de4b-2285-75ef-a819-e431d3dc71fb
title: Restore Devin's missing seven-day quota from the current native status response
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0de4b-5cfb-7da2-81f1-c5361d87d671",
    "status": "done"
  }
---
The operator sees 7d in the native Devin client, while Tagma's Pro row measured at 2026-09-26T14:55:54Z carried only 1d. The retained native `bare.wire.json` status response from Devin 3000.11.1 on Sep 22 carried dailyRemaining=100, weeklyRemaining=46 and hideWeekly=false. Compare the current native client's status request and raw protobuf response with Tagma's request and decoder for the same subscription; locate where 7d is lost and fix its producer, not the UI or a fabricated percentage. Start at `packages/llm/src/profiles/devin.ts`, `llm/protocols/devin/devin.proto` and the Devin capture client. Prove a fresh status read renders both windows when native does, preserve real hide/absence semantics, reconcile anchored claims, review and commit. Do not run a paid model inference matrix merely to read status.