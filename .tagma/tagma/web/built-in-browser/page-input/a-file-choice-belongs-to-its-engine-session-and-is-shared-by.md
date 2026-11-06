---
id: 01a1b249-001a-7973-a115-afe3475c75fb
title: A file choice belongs to its engine session and is shared by automation and viewers
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/engine/chooser.ts
---
The chooser event identifies the file field: a visible button can open a hidden input, so the clicked node is not an assignment target. Automation claims a chooser only after its pointer has reached the control and only while no operator input has arrived since the upload began; a native file input must be the event's own node. Any other chooser stays the operator's and is announced to viewers. The claim lasts until the chooser event or the end of the click's transient activation, so a page that opens its picker from a later task still uploads. Scoped interception is shared with screencast viewers, so ending an automated upload cannot disable a viewer's chooser; a claimed chooser left unanswered by a refused upload returns to the operator.