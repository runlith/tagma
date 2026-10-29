---
id: 01a15134-0b9f-7e2c-809e-ec1b1be9c7ca
title: The release channel recursively removes staging on a live server loop
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15136-4972-7873-a568-2f09003087d7",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15120-d727-72aa-b665-acc0f13fcc59
sources:
  - kind: file
    ref: apps/tagma/server/src/release-channel/runner.ts
---
Recursive cleanup of the release channel's staging moved to native async `FileSystem.remove` in `makeReleaseChannel`. Install and stop hold one admission lane; a replacement waits for the predecessor's cleanup to finish, and the landed flag is recorded before async cleanup after install-from. A started filesystem call runs to completion before the resource is released; background delivery stays interruptible. On a separate synthetic home, `runner.stest.ts` passed 7 tests (48 assertions): success/restart, failure, stop, competing admission, replacement and rollback. A targeted `bun run typecheck` of the whole delivery passed on one snapshot; the last run has no diagnostics of its own, transitive dependencies met someone else's changed operation claims (35 errors in 10 files). The operator's live server was untouched. Real latency of a large tree was not measured. One independent review of the whole delivery [[01a15143-2305-7aa1-b2bd-bef8070ec0a7|fs-delivery-review]] finished with no findings.
