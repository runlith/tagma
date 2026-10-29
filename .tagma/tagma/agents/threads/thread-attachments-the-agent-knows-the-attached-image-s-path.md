---
id: 01a1167b-7785-79ac-bda1-de452b7619a8
title: "Thread attachments: the agent knows the attached image's path, and a PDF attaches as a file with a path"
ord: 23
tags: ["task"]
fields:
  {
    "holder": "tagma:01a11666-b254-7d45-bc47-6b1c82fca86c",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/resources/attachments.ts
  - kind: file
    ref: packages/agent/src/transcript/attachments.ts
---
Operator: the agent sees an attached image but does not know its file location, so it cannot forward, copy or mail it; a PDF cannot be attached at all, even though `read` reads PDFs page by page.

What to do:
- **Image path.** When the server substitutes an attached image into the request (`ThreadAttachmentStore.hydrate`), it is followed by a line with that thread's file absolute path. The path is computed at substitution, not stored in the message: a fork links files into its own folder, and its path points at its own copy. External harnesses receive the same line (`external-harnesses/protocol/pictures.ts`), and for an unsent image — the path in a line saying it was not sent.
- **PDF as an attachment.** Composer, paste and drop accept PDFs; the server accepts `application/pdf` up to 64 MB with a `%PDF-` signature check, stores it under its original (sanitized) name in its own id's folder; in the model message a PDF is a line with name and path, the agent reads it itself. The feed shows a PDF as a tile that opens the file.
- Compaction (pruning, omission on overflow, image budget) counts only `image/*` as images, so the PDF line does not drop out as an image.
- A defect found along the way: a markdown document in a steer message's attachment leaves via the `media` part as `text/markdown` and drops the request; the signal must carry the document as text, like a plain message.

Proof: store tests (path in hydration, PDF under its own name, fork), HTTP-door tests (PDF upload with name, refusal on non-PDF), external-harness, draft tests (PDF leaves as an upload); affected-package typecheck and tests green.
