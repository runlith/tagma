---
id: 01a14bc0-75bb-73fc-8d6e-9df22504cfd8
title: Operator attaches images and PDFs to a message — by button, paste, drag, or phone camera
ord: 5
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc0-7671-7bdb-92a9-e696a4e069a4
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/mobile/Options.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/ThreadUploads.ts
  - kind: file
    ref: apps/tagma/server/src/http/contract/wire/threads.ts
  - kind: file
    ref: apps/tagma/server/src/threads/resources/attachments.ts
  - kind: file
    ref: packages/agent/src/transcript/attachments.ts
  - kind: file
    ref: packages/chat-ui/src/draftFiles.ts
  - kind: file
    ref: packages/chat-ui/src/draftImages.ts
  - kind: file
    ref: packages/chat-ui/src/fileIntake.svelte.ts
---
**Value.** The operator shows the agent a screenshot, photo, or PDF right in the message, from desktop or the phone camera.

**How.** The paperclip in the composer, paste from the clipboard, drag onto the feed; on the phone — a sheet with photo, camera, and PDF. A call slice (A8) and a built-in browser page element (A9) put documents into the draft the same way.

**Behaviour.**
- Images of common formats and PDFs are accepted; an image of a foreign format or too large (HEIC from the phone) is redrawn by the app itself into a fitting one.
- On send the bytes upload into the thread's folder on the server, the message carries a link to them.
- The image reaches the model as an image. A PDF never reaches the model as bytes: the agent gets the file path and reads it with file tools. The document arrives as text.
- A file gone from disk becomes a gone-file line in the next request, the turn does not break. A thread fork gets the same files.

**Limits.** Other file types and files over the size limit are refused with an explanation in the composer. An upload failure returns the whole draft. Attachments live as long as the thread lives.
