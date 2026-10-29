---
id: 01a17045-2a0d-7631-9571-81e6c4363f85
title: The operator and agent export motion from a card to MP4, frame by frame as in the player
ord: 3
tags: ["feature"]
fields:
  {
    "state": "partial"
  }
edges:
  - kind: relates
    to: 01a14c08-8336-7b3c-965a-b08f2e1bad5a
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/pages/VideoExport.svelte
  - kind: file
    ref: apps/tagma/server/src/artifacts/videos.ts
  - kind: file
    ref: apps/tagma/server/src/page-render/film.ts
---
**Value.** Motion an agent made as a page is also needed as a plain video file — for a presentation, a social network or a site where there is no Tagma card. Neither operator nor agent needs ffmpeg or editing software: the server itself shoots the clip, frame by frame as in the card player.

**How.** An export button in the card player and the page tab with a 1× or 2× choice; the agent — via the `export_artifact_video` operation on a page on the shelf. Frame progress goes into the card and the tab, an export can be cancelled; when ready the file downloads, and an agent call renders in the feed as a row with the clip.

**Behaviour.**
- The clip belongs to the page version: it lies next to it, leaves with it when the shelf is trimmed, and a new export is needed after republishing.
- Re-exporting the same version and scale joins the running one or immediately hands the finished file, without re-shooting.
- Exports wait in a queue, their count and the number of shooting targets come from the machine's core count; a job that will not fit on disk refuses before starting.
- The server's managed Chromium shoots and encodes, so export works with no open app; on a machine with no Chrome for Testing build and no installed Chrome — a refusal with a way out.

**Limits.** H.264 MP4 with no sound. Only pages with a timeline, up to 300 s. Export has encoded clips in a live Chromium on macOS — a 210-frame 1080p and a 30-frame one in itest; frame-by-frame comparison of clip against player, memory and time measurements on long clips were not done; linux and windows not checked.
