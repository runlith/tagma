---
id: 01a1855d-3cba-79a9-9292-f30f21312206
title: Agent records a page to an MP4 video the operator plays in the thread
ord: 13
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-046ed78e542a
  - kind: relates
    to: 01a18514-e6b1-7065-9cc4-fb7c178bcfc9
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/browser/Measuring.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/browser/ToolCard.svelte
  - kind: file
    ref: apps/tagma/server/src/browser/contract/wire/recordOperations.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/recording.ts
  - kind: file
    ref: apps/tagma/server/src/page-render/clips.ts
---
**Value.** An agent proves a flow it fixed with a video instead of a description, and the operator watches it later in the thread without replaying anything; no ffmpeg or screen-recording permission is needed.

**How.** `record_page` with `start`, the usual page tools, then `stop`; the stop's card in the thread plays the clip.

**Behaviour.**
- The recording watches the same frame stream as every viewer of the page, so it costs no second capture and a viewer watching at the same time keeps getting frames; while recording, a hidden desktop page is still drawn.
- Frames arrive only when the page changes; each picture holds until the next, so the clip lasts as long as the recording ran (10 fps by default, at most 30).
- `start` answers once the first frame is encoded, so a missing encoder or capture browser refuses at start, not at stop. `stop` answers the MP4 file, its duration, frame size and byte size.
- The frame size is the stream's: a smaller viewer of the page, such as a phone, lowers it, and later frames of another size are fitted into the first frame's size.
- A page holds one recording; a thread's recording stops when its run ends, and a recording ends when its page closes or its browser session is lost; each ending writes a complete file. The ten newest recordings of a page are kept.
- While it runs, the browser panel and the phone page view show who started it and for how long, with one Stop.
- The recording belongs to the thread that started it however it ends: after an operator Stop, a run end, a page close or a lost session, that thread's next `stop` answers the file with how it ended and who ended it, so the clip plays in its thread, even once the page has closed. The ended recording waits per page until its thread collects it or a new recording starts there.

**Limits.** Encoding runs in the managed capture browser, so a desktop recording starts that browser too. A server shutdown mid-recording leaves no file. The desktop path is proven by code, not by a run.
