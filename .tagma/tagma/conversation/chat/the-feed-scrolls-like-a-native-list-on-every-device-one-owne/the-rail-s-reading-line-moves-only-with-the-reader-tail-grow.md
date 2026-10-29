---
id: 01a18345-c1a2-73d0-96be-a99280b5f328
title: "The rail's reading line moves only with the reader: tail growth, a short viewport or a select that cannot land never change the gold tile"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18328-219e-70c1-b845-02e7015e958d",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a18327-db3a-7478-a68b-f4b0f38a25ae
  - kind: implements
    to: 01a18327-c7aa-7718-b037-fece2ea21922
sources:
  - kind: file
    ref: packages/chat-ui/src/transcriptCursor.ts
  - kind: file
    ref: packages/chat-ui/src/TranscriptViewport.svelte.ts
---
Correction of f38a25ae (commit f7fbae6d), found by the spec reviews. `readingLine` interpolates on the live distance to the end, so content growing below a stopped reader moves the line up and the gold tile flips to the previous message while nothing on screen moved; a shrink does the reverse. A visible height under 100 px puts the fixed line under the composer. A rail select in the last screen cannot reach its landing gap, and the first move afterwards lights another message while the clicked one is still visible. The line's place in the last screen is fixed by the reader's position at their last own movement (or the tail while following); a select that cannot land keeps its row current while it is visible.