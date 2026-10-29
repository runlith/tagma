---
id: 01a13bfb-2ee0-73db-a98d-1275a115d5a0
title: "History list under the desktop “back” / “forward” arrows: recent places by their own names"
ord: 5
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a13bf1-b503-7743-bd05-8779b54911b3
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/BackForward.svelte
---
Right-click or long-press on the “back” / “forward” arrow in the desktop header opens a list of recent places, as in Chrome and Safari. A click on a row goes straight there.

Entries come from `navigation.entries()`, the jump from `navigation.traverseTo(key)`.

What is missing: each entry needs the name of its place. Currently the page title is `<project> · <section>` (`currentTitle` in `features/workspace/address.ts`), so every thread reads the same: `runlith · Agents`. Each surface needs to name its own place — the thread name, block, file path, settings section — and that name should be remembered at the entry where it was shown.

Done when the list tells places apart by their own names and following a row opens exactly that place.
