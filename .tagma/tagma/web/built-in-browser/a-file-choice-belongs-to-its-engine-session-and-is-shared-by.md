---
id: 01a1b249-001a-7973-a115-afe3475c75fb
title: A file choice belongs to its engine session and is shared by automation and viewers
ord: 59
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/engine/chooser.ts
---
The chooser event identifies the file field: a visible button can open a hidden input, so the clicked node is not an assignment target. Automation claims the chooser before clicking and supplies files only after the click's acknowledgement and queued chooser events have been applied. Scoped interception is shared with screencast viewers, so ending an automated upload cannot disable a viewer's chooser or announce that automated choice as an operator request.