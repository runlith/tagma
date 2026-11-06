---
id: 01a14c08-1c3f-7bde-a2e3-046ed78e542a
title: "From the phone and the web client, any page is watched and driven by screencast: touch, keyboard, clipboard, and file picking"
ord: 9
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc0-76f5-7c7d-bd06-8e7f03fd84a3
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-046b8ddec8bc
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-046de2a2ecf8
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/browser/screencast
  - kind: file
    ref: apps/tagma/app/src/lib/features/browser/PagesScreen.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/browser/surfaces.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/screencast.ts
---
**Value.** From a phone or the web client, the operator sees and drives any page — a desktop page on a Mac or an agent page in managed Chromium.

**How.** On the phone, the Pages tab (route `/w`) — the project's page list and a full-screen page; in the web client and in the desktop panel for foreign-host pages — the same screencast view. Underneath are the live `browser.screencast`, `browser.input`, and `browser.files` feeds.

**Behaviour.**
- JPEG frames stream; several viewers of one page share a single stream, quality is the minimum requested, and each viewer sets its own pace.
- Input: mouse, wheel, keys, typed text through IME, touch as tap and scroll, copy and paste through the clipboard; a keyboard button on the phone.
- A managed page in fast mode lays out to the viewer's area; human-mode pages and pages with native desktop views keep their native size.
- A page file picker opens the viewer's file picker; files go to the page.
- On the phone — back, reload, downloads, and dialog answers.

**Limits.** A new page cannot be opened from the phone, and no URL can be entered — only open pages can be watched and driven. No more than 11 MiB of files leaves at once.
