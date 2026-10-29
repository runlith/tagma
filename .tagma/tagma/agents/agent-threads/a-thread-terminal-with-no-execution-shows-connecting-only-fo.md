---
id: 01a173de-0965-73e9-b649-4ac37fe40328
title: A thread terminal with no execution shows "Connecting" only for a starting or stopping session; one ended in failure or unknown shows the reason and "Start again"
ord: 25
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a173cf-0288-7082-84d8-54ec5464ef76
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/external/Terminal.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/Terminal.svelte.ts
---
`ThreadTerminal` renders the surface state from the current session's thread row. It deliberately keeps the previous session's panel, so that panel says nothing about the new session: with the session holding no execution (`execution` empty), "Connecting" remains only for one that is still starting or stopping. A session `ended` with `process.failure` (`failed`) and a session `uncertain` — unknown whether the CLI started — show their reason as a card over the kept panel, if there is one. The `failed` header does not assert the CLI never launched: the reason itself says that, or says nothing. Without this, a program defect before the CLI launch held "Connecting to …" forever, though there was nothing to wait for.

Such a session is continued by restarting the agent (`ThreadList.restart`): it stops the turn, releases the session (a stop also ends `uncertain`) and raises the CLI again. The terminal surface has no composer, so the action stands on the card itself. A session `ended` with an execution still shows the process end on its panel.
