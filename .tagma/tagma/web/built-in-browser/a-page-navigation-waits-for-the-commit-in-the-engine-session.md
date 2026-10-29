---
id: 01a16e0a-8fe7-710a-b08b-dcd39883a92d
title: A page navigation waits for the commit in the engine session, not just the host session's answer
ord: 7
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/engine/automation.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/drive.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/frames.ts
---
The host and the engine hold different CDP sessions: the new-document event may already have reached the host while the engine still holds the loader and the isolated-world context of the previous document. Before answering navigation, the engine waits for its own frameNavigated for the loader from the current frame tree; otherwise the next snapshot loses links, and the action reaches for an already-destroyed context. A new loader also retires the outgoing document's descendant frames, references and isolated worlds: cross-process commits can omit their individual detach events, leaving later reads aimed at frames that no longer exist. Adoption readiness belongs to the child session: process swaps can overlap sessions for one frame, and retiring the outgoing session must not erase the replacement's readiness or let its reads run before adoption finishes. Outgoing tree replies and navigation events cannot publish over the replacement's frame ownership.
