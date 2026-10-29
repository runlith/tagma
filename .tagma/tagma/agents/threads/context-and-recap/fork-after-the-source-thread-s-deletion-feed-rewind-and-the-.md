---
id: 01a116a3-9bbf-721e-b1d7-dcbf9bcea0cd
title: "Fork after the source thread's deletion: feed, rewind and the external harness session point at the source thread's attachments"
ord: 9
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
    ref: apps/tagma/server/src/composition/http/threads.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/pictures.ts
---
A fork links attachment files into its own folder, but its feed records, the rewind draft and the external harness session history keep pointing at the source thread. While the source thread lives, everything works; after its deletion the links point into the void, even though the fork's copy is intact. Feed images behaved this way before; now PDFs do too.

Where (d6e19a61b0 commit review, sol-review):
- `ThreadBranch` copies records unchanged, the attachment URL names the source thread; the `attachment` HTTP route (`apps/tagma/server/src/composition/http/threads.ts`) reads the thread from the URL, so the fork feed's PDF tile and image answer 404;
- the fork's rewind fetches the attachment by the same URL (`ChatPort.attachmentFile`);
- forking an external harness session (Claude over ACP) keeps the source thread's prompts with its absolute paths (`external-harnesses/protocol/pictures.ts`, `runner/claude/lifecycle.ts`).

Done when, after the source thread's deletion, the fork shows and opens its attachments from the feed, returns them to the draft on rewind, and its agent receives a working path; one source-deletion test per path.
