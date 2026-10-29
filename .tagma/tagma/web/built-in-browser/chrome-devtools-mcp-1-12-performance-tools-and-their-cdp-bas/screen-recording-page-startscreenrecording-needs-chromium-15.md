---
id: 01a184dc-4fbe-7b01-a2d5-4fab5de286e3
title: "Screen recording: Page.startScreenRecording needs Chromium 153 and cannot run beside Page.startScreencast on one session"
ord: 5
tags: ["research"]
fields:
  {
    "source": {
      "name": "chrome-devtools-mcp screencast tools; Chromium PageHandler",
      "ref": "chrome-devtools-mcp 63170b11a2fa74d5ceea757194d7b25f3e145f68 src/tools/screencast.ts; devtools-protocol master Page.pdl; Chromium main page_handler.cc; pptr.dev page.record, puppeteer PR #15387, issue #15591"
    }
  }
---
**chrome-devtools-mcp, observed** (`src/tools/screencast.ts`):
- `screencast_start {filePath?}` / `screencast_stop`. By default it calls puppeteer `page.record({path, fps, maxWidth, maxHeight})` with the viewport's device-pixel size read by `evaluate` (otherwise Chrome downscales), always MP4. Behind `--experimentalScreencast` it uses the older `page.screencast()` — `Page.startScreencast` frames piped into ffmpeg, MP4 or WebM, failing when ffmpeg is missing.

**CDP and Chromium.**
- `Page.startScreenRecording {audio, maxWidth, maxHeight, frameRate}` → an `IO.StreamHandle` of the encoded video; `Page.stopScreenRecording` → the stream (experimental). Chromium's `PageHandler::StartScreenRecording` defaults to 800×600 at 30 fps.
- `PageHandler::StartScreencast` and `StartScreenRecording` each refuse with "Screencast is already active" while either runs: one CDP session carries a frame screencast or a recording, never both.
- Puppeteer documents `page.record()` as needing Chrome 153 or later; its issue #15591 reports "'Page.startScreenRecording' wasn't found" on Chrome 152 (secondary sources). Electron 44.8 ships Chromium 152, and the managed-host experiments used Chrome for Testing 151, so neither has the command.
- `Page.startScreencast {format, quality, maxWidth, maxHeight, everyNthFrame, maxFramesInFlight, sendLastFrame}` delivers JPEG or PNG frames that each need `Page.screencastFrameAck`; a static page sends no new frames.

**Cost and detection (inference).** Recording needs the page drawn, as any screencast does; a page sees no domain change and only stays visible and unthrottled while drawn.
