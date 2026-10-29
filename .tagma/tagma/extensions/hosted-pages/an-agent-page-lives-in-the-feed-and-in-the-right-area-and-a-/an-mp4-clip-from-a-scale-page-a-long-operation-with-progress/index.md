---
id: 01a16fe4-0257-7648-8de9-acf50b5eda77
title: "\"An MP4 clip from a scale page: a long operation with progress and cancel, streaming WebCodecs encoding, the clip at the version\""
ord: 5
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/artifacts
---
## What the operator sees

On motion in the player, an "Export MP4" button with a scale choice (1×, 2×). Frame progress shows in the card and tab, export can cancel, at the end the file downloads and stays with the version. The agent gets the same action and hands the clip over itself; its export call draws in the feed as a row with the clip and a link.

## Operation

`export_artifact_video` (effect `write`, `tool: {capability: 'artifacts'}`): input is page, version (current by default), scale. This is a long operation on the `read_worktree_operation` pattern: the answer immediately carries the job id, state and progress show in page reading by id, a call with the same input joins the running job or serves the ready file. Cancel by the operator from the player or by the agent via the job id (`cancel_artifact_video`); a cancelled job leaves no file at the version and leaves page state with no row.

- A job id is the hash of page, version, and scale, so a repeat with the same input finds the running job with no call registry; the ready file is recognized by name at the version.
- If a slot is free, the answer awaits the codec check and target opening: an unavailable codec or browser is a true call refusal. A job starting later from the queue shows its refusal in state as `failed` with a reason.
- Page state is `PageState = { current, kept, videos }`: jobs and ready clips of all versions from `kept`; `videos` joins the `artifacts.page` channel from the shelf (`ShelfState`) and jobs, so progress never travels the shelf worker.

## How captured and encoded

- Frames capture through the same port and target as [[0fc6fa99|time frames]]; scale is `deviceScaleFactor` at the same layout, so 2× is sharp, not different.
- **The codec is a variant inside the adapter** ([[6f758080]]). Default is WebCodecs `VideoEncoder` (`avc1`) in Chromium of the same host: Bun has no encoder, ffmpeg stands on no machine. The cost is named: every frame travels to the server as a capture and back to the encoding target, and encoded chunks travel to the server again. Captures are JPEG q≈95, not PNG. Before start, `VideoEncoder.isConfigSupported` — a refusal with an exit if the codec is unavailable.
- The encoder stands in a separate target of the same capture browser. The H.264 profile tries High → Main → Constrained Baseline, the level takes the smallest fitting size and fps; bitrate is 0.15 bits per frame pixel, a keyframe every 2 s.
- **A stream with backpressure.** Frames never pile: encoding a frame call returns only when the encoder queue (`encodeQueueSize`) is 2 or less, and the `Render` stream pulls the next frame after the previous is encoded and multiplexed. No more frames in flight than capture targets; memory never grows with frame count.
- **Parallelism.** A frame is a function of t, so frames capture on several targets at once. Simultaneous exports are `max(1, ⌊cores/8⌋)`, targets per export `⌊cores/(2·exports)⌋` within 1…4 ([[fe83acfa]]): 4 cores mean one export on 2 targets, 12 one on 4, 16 two on 4. The rest wait in queue.
- **The server multiplexer** is `mediabunny` in a Bun Worker with `fastStart: 'reserve'`: room for `moov` is reserved at the file head by known frame count, so the file plays from the start at once, and frames never sit in memory. The track `frameRate` makes the timescale a multiple of fps: a probe with synthetic packets gave 180 packets at 30 fps — exactly 6.00 s.
- Encoding and multiplexing run off the server event loop ([[7a910861]]).

## Storage and serving

- The file at the version: `/a/<id>/v/<version>/video-<fps>-<scale>x.mp4`; version clips leave with it when trimmed to 20 versions.
- The route serves MP4 with `Range` (Safari on a phone never plays without) and `Content-Disposition` for download.
- Disk bound: the clip is stored only at versions the shelf keeps; a job that would exceed free space refuses before starting (`disk-full`). Space is checked at admission and again at slot grant, minus estimates of running exports; the estimate is twice the bitrate budget over the duration. Unread free space is written to the log and never blocks export.
- A `.part` left after process death is deleted on the next reading of the version clips unless a running job writes it.
- While a job runs, the file is written beside as `.part` and renamed only after `moov` is written: a cancelled or crashed job deletes `.part`, and the shelf and route see only ready clips.

## Acceptance (performer)

- A 6 s, 30 fps, 1920×1080 page → H.264 MP4, 180 frames, 6.00 s (container parse).
- Clip frame k matches `read_artifact_frames` capture k (within compression tolerance).
- A repeat with the same input never re-captures; a second call during export joins the job.
- Cancel mid-export: targets closed, no file at the version.
- Server peak memory over 300 frames is no more than over 60 (measured).
- A refusal with an exit when the codec is unavailable or there is no browser.
- MP4 served with `Range` and `Content-Disposition`.
- An itest of the operation through its door: a short page, frame count and duration.
- Export-time measurement of a 6-second 1080p clip on the performer machine recorded as a sample; mac, linux, and windows — where there is a machine, the rest named untested.

## What of acceptance is unproven

The code stands (9f1edd5d23), but no clip was ever encoded in live Chromium: the operator banned browser checks in this work ([[c6569513]]). Without a browser, repeat-joining and no-file cancel are proven (`artifacts/videos.itest.ts` over `Videos` with driven `Film`), `Range` and `Content-Disposition` (`composition/testing/http/artifacts.itest.ts`), container duration on synthetic packets (probe: 180 packets at 30 fps — 6.00 s). Never run are `page-render/video.itest.ts` (real export, MP4 parse, cancel with closed targets), clip-frame vs `read_artifact_frames` match, the "codec unavailable" refusal, the 300-vs-60-frame peak-memory measure, and 1080p export time; linux and windows untested.
