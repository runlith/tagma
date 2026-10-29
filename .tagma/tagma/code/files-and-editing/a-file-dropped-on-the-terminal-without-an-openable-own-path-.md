---
id: 01a17174-539a-7e46-a25c-449724a75ef9
title: A file dropped on the terminal without an openable own path is copied unchanged into the thread's folder on the server
ord: 11
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/fileDrop.ts
  - kind: file
    ref: apps/tagma/desktop/src/preload.ts
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/drops.ts
  - kind: symbol
    ref: apps/tagma/server/src/threads/resources/attachments.ts
    symbol: AttachmentFiles
---
An own path works only when the CLI can open it. That means desktop with the server on the same machine: a client file's path means nothing on a remote server. A macOS screenshot thumbnail (`TemporaryItems/NSIRD_*`) does not work either, although it has a path: the system lets only the app that accepted the drag open it. The CLI process launched by the terminal holder would get EPERM. So desktop answers it with an empty path, and the accepting window reads the bytes.

The copy is not kept as a chat attachment. An attachment recompresses the image for the model, checks markdown for the title, and accepts only images, PDFs, and md. But the CLI needs the original file of any type under its own name. The copy lies in `drops/<uuid>/<name>` of the thread's folder, outside the repository. So it never lands in the working tree, unlike Orca's `.orca/drops`, and is deleted with the thread. A fork does not carry the copy: the fork's CLI keeps naming the original thread's path.

The upload body is read whole on both sides. Hence the wire's size limit, which the app checks before reading bytes. For the same reason, files of one drop load one after another, not all at once.
