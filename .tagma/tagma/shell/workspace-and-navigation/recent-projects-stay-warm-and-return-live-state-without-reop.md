---
id: 01a14c05-9e8f-7c75-a633-b2a559161fe2
title: Recent projects stay warm and return live state without reopening subscriptions
ord: 3
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc0-754e-7774-9bf0-abe5760fe634
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2a43cf80c5f
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/Shell.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/projects/Strip.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/projects/WarmHold.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/projects/WarmHolds.svelte
---
**Value.** Returning to a recently visited project uses already live state, instead of reopening all its subscriptions.

**How.** The shell automatically holds the scope of the current and several recent projects from the bar via `App.hold`.

**Behaviour.** Project and graph services with their live state are kept. Warmth goes only to a project visited in this window; further moves and removal from the bar release the holds. A branch switch replaces the graph hold. A background project keeps its data but does not publish its sections and actions into the current window's project.

**Limits.** The page remounts, and the thread feed is not held here: a separate chat-session mechanism returns it. Reads without a live observer may reach the server again. Warmth promises to speed up neither the first entry, any render nor any request; memory and traffic grow with held projects.
