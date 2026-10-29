---
id: 01a11690-e97e-7f01-a05a-06f11f601161
title: The model receives an attachment's file path as a string at request-substitution time; the message stores only the link
ord: 7
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1167b-7785-79ac-bda1-de452b7619a8
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/resources/attachments.ts
  - kind: symbol
    ref: packages/agent/src/thread/compaction/media.ts
    symbol: isPicturePart
---
The message stores an attachment as a `/api/threads/<thread>/attachments/<id>` link, while the on-disk file path is appended at request substitution (`hydrate`), not when the message is written. A fork does not copy files: the attachment is looked up in its own thread's folder, then in the folders of threads whose prefix it reads (`thread_base`), and the inherited history keeps naming the source thread.

- **The string names the source thread's file.** Then the fork's request prefix matches the source's prefix byte for byte, and the fork reads its cache. A deleted source's folder is not freed while a branch layer references it, so the string stays valid even after the source's deletion.
- **A PDF is stored under its cleaned source name in its id's folder** (`<thread>/<uuid>/<name>.pdf`), so the path carries the real name: the agent forwards or copies the file without renaming. The model receives the PDF only as a path string, no bytes, and the agent reads it itself (`read` page by page). It never leaves as a `media` part on any wire.
- **An external harness receives the path once, in the turn's prompt.** Its session fork at the vendor keeps naming the source thread's file even after the source thread is deleted.
- **A missing picture or PDF file becomes a string, not a request failure.** Otherwise one deleted picture would fail every next turn of the thread.
- **Compaction counts only `image/*` as pictures** (`isPicturePart`). Otherwise the picture budget and omission on overflow would replace a PDF link with an "omitted" marker, and the agent would lose the path.
