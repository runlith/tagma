---
id: 01a17009-000f-7ff2-9e3c-a15ed36c1f56
title: Page card draws its own call's version, while its place and tab read one live page subscription by id
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/pages/MotionView.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/pages/PageCard.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/pages/PageStates.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/pages/panes.ts
  - kind: file
    ref: apps/tagma/app/src/lib/shared/Transport.svelte
---
A card is drawn from the feed record — its own version's `publish_artifact` answer, with no second request — while whether this version is current, replaced, or no longer held by the shelf it reads from `PageStates`: one live `artifacts.page` subscription on the page id in the project, shared by all cards of that page and its tab, dropped by the last reader. Otherwise ten edits of one page would hold ten subscriptions.

Until the subscription answers, the card stands as a final-size stub and mounts no frame: a replaced card in history folds at once and starts no motion for a single frame. For the same reason a tab's `stands` of `artifact` answers `null` until the answer, and a window reload or server restart does not wipe the tab from the layout.

A motion frame is `inert`, and the click is caught by a transparent button over it: focus never leaves into the iframe, so Space and arrows reach the app transport. The transport (`shared/Transport.svelte`) is one for calls and motion and hands keys to the player whose area holds focus, otherwise to the last touched one; a newly appeared player takes them only while nobody holds them — otherwise a card the virtualizer mounted on scroll would steal keys from the call.
