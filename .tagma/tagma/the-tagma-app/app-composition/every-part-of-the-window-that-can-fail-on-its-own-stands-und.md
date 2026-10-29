---
id: 01a1617b-1464-7fdb-b83d-acd3d83d0722
title: "Every part of the window that can fail on its own stands under its own error boundary: an exception without a boundary stops all effects of the root"
ord: 2
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a16164-555e-783a-b03d-6e2dbe7f3499
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/Shell.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/Root.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/Window.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/notices/FaultReporter.ts
  - kind: file
    ref: packages/chat-ui/src/TranscriptRow.svelte
---
In Svelte 5 async mode an effect that throws without a `<svelte:boundary>` above it leaves all effects of its root never run, and the window has a single `App.mount` root: without boundaries one exception in any row freezes the whole interface until reload, while data keeps arriving. So a boundary stands over every part that can fail on its own: the chat feed row (`TranscriptRow`), column, page, right area and shell status bar, every dialog and launcher and overlay hosts — and over the whole window. The failed part shows its message and Reset, the rest keeps living; the Errors list stands in the status bar, outside the feed and page boundaries, and keeps showing failures.

A boundary catches only its descendants' exceptions, while the effects of the component that draws it stand above it. So `Root` holds only graph mounting, boundary config, and window listeners, and effects and window markup live in `Window` under the `window` boundary.

The boundary config (`provideErrorBoundaryConfig` in `Root`) is a port: the chat kit uses the boundary without knowing the app, and the app routes the report to `Notices`, the single owner of window failures, with a place — the boundary `id`, for a feed row the row kind and tool name. A window `error` event with no `error` value never enters the list: that is how ResizeObserver loop notifications and opaque "Script error." from a foreign origin arrive, with neither stack nor place.
