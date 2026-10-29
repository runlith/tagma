---
id: 01a1482d-919e-7358-a621-54af00d20c20
title: Managed-host navigation answers after the document commit, and reads history tolerating refusal mid-navigation
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/managed-browser/commit.ts
  - kind: file
    ref: apps/tagma/server/src/managed-browser/host.ts
---
`Page.navigate` answers before the new document commits, and `Page.getNavigationHistory` refuses with “Not attached to an active page” during the first ~200 ms of navigation (one sample, CfT 151, macOS). So `navigate` waits for the top frame's `frameNavigated` with the response's `loaderId` (or `navigatedWithinDocument`, or the started/stopped loading pair for navigation without a new document) and takes the address from it, while history reading skips the refusal and refreshes on the next event. Without this the navigation answer would carry the old address and the engine would hand out the old document's links.
