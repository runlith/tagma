---
id: 01a15a04-9ad4-7f2a-86d0-a241ef615162
title: Copying a thread and viewer-modal image to the clipboard
ord: 53
tags: ["task"]
fields:
  {
    "holder": "tagma:01a159a7-e47f-78b7-99ce-7843e462a656",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/chat-ui/src/ImageViewer.svelte
  - kind: file
    ref: packages/chat-ui/src/surface.ts
---
A thread image cannot be copied back: the desktop main window has no context menu, and the viewer modal has no copy action. The operator-agreed layout is the "Copy image" artifact.

Do:
- the chat declares the image menu and copy action in `ChatNavigation`; attachment thumbnails, tool-step thumbnails, and the draft call the menu on right click;
- `ImageViewer`: a copy button next to the cross, ⌘C/Ctrl+C on empty selection, a menu on right click inside the dialog;
- the app draws the menu with its `DropdownMenu` at the cursor (portal into `<dialog>` when the click was in the modal) and writes the full-size PNG to the buffer, transcoding other formats.

Proof: an owner test of copying (non-PNG in → `image/png` in the buffer), chat-ui and app typecheck.
