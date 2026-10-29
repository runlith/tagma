---
id: 01a116a3-9b81-7462-b493-8acf96c88034
title: "An attachment path survives context compaction: summarization, image budget and omission on overflow"
ord: 8
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a1167b-7785-79ac-bda1-de452b7619a8
sources:
  - kind: file
    ref: packages/agent/src/thread/compaction/media.ts
  - kind: file
    ref: packages/agent/src/thread/compaction/segmentText.ts
---
An image or PDF path is appended only when the link is substituted into the request (`ThreadAttachmentStore.hydrate`). While the link survives, the agent knows the path; when context compaction removes it, the path goes with it, even though the file stays on disk.

Where it is lost (d6e19a61b0 commit review, sol-review):
- the shared and foreign summarizers serialize unsubstituted messages: `serializeThreadMessage` (`packages/agent/src/thread/compaction/segmentText.ts`) writes an attachment as `[Attached application/pdf]`, with no name or path; `ThreadCompaction.folded` does not substitute them, unlike provider compaction;
- `omitThreadMedia` (`compaction/media.ts`) on image budget and overflow replaces the link with an `omittedMedia` marker (`apps/tagma/server/src/native-harness/compaction/policy.ts`) before substitution, and the path line never appears.

Done when, after summarization, image pruning and omission on overflow, the next request still names the file path of every removed attachment; one test per path.
