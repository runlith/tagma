---
id: 01a0d09a-0d1f-7355-ac70-8db301ae8335
title: "Every agent commits its own lines itself: submit_work lands the session's own hunks, carries a peer's lines when it must, and no prompt invites negotiating a commit"
ord: 42
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d09a-48a0-7f12-b48e-1002800f2444",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0d0a7-c14d-73e8-a333-1f082a55b1e4
sources:
  - kind: file
    ref: apps/tagma/server/src/doctrine/sections/gitAndGithub.ts
  - kind: file
    ref: apps/tagma/server/src/doctrine/sections/theSharedCheckout.ts
  - kind: file
    ref: apps/tagma/server/src/harness/submitWork.ts
---
The operator's word (2026-09-23): no bureaucracy between agents over commits. Every agent commits its own work itself as soon as it is ready. When something goes wrong, it commits a peer's lines along with its own and writes to nobody. Rule [[621b98d5]] says this now for runlith. This task makes Tagma itself work that way for every project.

Evidence. Build-request-obligation lost 10 minutes (23:02–23:12 UTC) to compaction-collab's "take your hunks out / put them back / take them out again". It then handed its own line to compaction-pin's commit `31226bdcd8`. Earlier the same day build-host-lanes, build-stop-ladder and build-server-lanes put their landing in an agreed order because they shared 8 files. There are three causes:
- `submit_work` (`apps/tagma/server/src/harness/submitWork.ts`) commits whole files, so a shared file carries the peer's lines.
- The doctrine (`apps/tagma/server/src/doctrine/sections/gitAndGithub.ts`, `theSharedCheckout.ts`) and the collaboration voice (`packages/agent/src/collaboration/CollaborationVoice.ts#concurrentGround`) read as "HEAD must build, don't divide a change, coordinate with the holder". Nothing in them forbids negotiation.
- Committing only one's own hunks through the index is refused for every spawned agent. `git commit` without paths is a sweep ([[3b6b9a9f]], `packages/agent-tools/src/shellShapes.ts#sweepShape`). A sweep asks the reader, and a child is never interactive (`threadRunInteractive`), so the ask becomes an `unattended` refusal.

Done when:
1. `submit_work` lands this session's own lines by default: the lines the change record attributes to it ([[372b147b]]). A peer's unfinished lines in the same files are left out, and the shared index is not disturbed.
2. Where its own lines cannot be cut away from a peer's, `submit_work` commits the peer's lines along with its own. The same happens when the agent asks for it. It never refuses and never needs a message. The receipt says what was carried.
3. The doctrine sections and the collaboration voice say one thing: commit your own work yourself at once; carry a peer's lines when needed; checks run on the working tree; never write to another agent about commits. Every sentence that invites negotiating a landing is gone. That includes "tell the holder when your commit carried their lines". Only a genuine edit conflict remains, where two writers change the same lines.
4. A spawned agent never reaches a commit road that asks a reader. The sweep refusal names `submit_work` as its way out.
5. A floor test: two sessions edit the same file in separate hunks, and each lands its own with no message between them. A session whose lines cannot be separated lands with the peer's lines carried.
6. The claims over the touched code are written or reconciled, and doctor over the touched paths is clean.

Write the decision under this area first (rule 8dab19b6), then build it. The operator already accepted the direction, so do not wait for an approval.
