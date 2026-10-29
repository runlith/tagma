---
id: 01a16fd0-c677-7a15-b69a-41860fc6fa99
title: "\"Time frames: the server captures page frame k on the scale in a hidden managed-Chromium target — for the agent to verify before publishing\""
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/artifacts
  - kind: dir
    ref: apps/tagma/server/src/browser
---
## Why

The server must capture page frame k on the time scale the same way the feed draws it. Agent self-check stands on this (it views its work before delivery instead of delivering blind), and the MP4 clip.

## What the agent and client get

The `read_artifact_frames` operation (effect `read`, `tool: {capability: 'artifacts'}`, like `list_artifacts`): input is a page file by path **before publication** or a page and version on the shelf, and k (up to 12). The answer is PNGs of these frames, downscaled to 960 px wide (target DPR `960 / width`: the same layout rasterized finer, with no re-encoding on the server); frame files lie in the caller's scratch (`frames/<id>/<version|draft>/<k>.png`), the agent gets them as images. Draft and version reach the target by intercepting the document request (`Fetch.fulfillRequest`) with the same CSP the shelf serves, plus the remote door's `sandbox`: verification creates no versions, litters no feed with cards, and never depends on the pages HTTP door.

## How captured

- **Capture target** is a new host-port method in the `browser` contract: an unlisted target (never in the project pages or the operator list) of a given viewport and DPR, freed by scope. The managed Chromium adapter implements it: a hidden target (`hidden: true`) in a separate capture browser with its own data dir — not the profile browser; the desktop host never implements it (`capture: null`), export runs on managed with no app. A hidden target in headless=new draws frames (verified: `requestAnimationFrame` runs, a 960×540 capture at DPR 0.5).
- **Port at `artifacts`.** `artifacts` is a lower module and never imports `browser`. It declares the `Render` port (`artifacts/contract/service/render.ts`): `frames` streams frames in request order — the next captures after the previous is taken, while `targets` capture targets in parallel; format is PNG or JPEG and scale set by the caller, so frames and the clip stand on one port. The adapter over `browser` is the page-render module, composition wires it ([[e090f46d]]).
- **Frame steps:** open the version as the top document in a `width×height` target; await `tagmaTimeline.prepared`; for k, `Runtime.evaluate` `seek(t_k)` with `awaitPromise`, then two rendered frames, then `Page.captureScreenshot`.
- **Verdict on facts** ([[7609a86c]]): `Runtime.exceptionThrown` before readiness, or a `load` event with no readiness after network loads finish, is a `page-failed` refusal with the exception text the agent needs for fixing. While the page loads or readies, waiting never times out.
- **No browser.** No attached managed browser and none installable is a typed refusal with an exit: no build for the platform (e.g. linux-arm64 at Chrome for Testing — "install Google Chrome"), needs network for first install, `host-away`. The capture browser takes installed Google Chrome where there is no Chrome for Testing. Installing Chrome for Testing on first capture shows download progress as a server background job (`Background`), which the app shows among load.
- **Input checked before opening:** no scale, k outside 0…N−1, over 12 frames — an immediate refusal.

## Acceptance (performer)

- Three k from a path draft are three 960-wide PNGs; no version appeared on the shelf.
- Operation frame k matches card-slider frame k: the same fragment `seek(t_k)`, with no frame shift. No pixel equality expected across sizes: the card scales the scene with `transform` while capture uses target DPR, and rasterization diverges in smoothing.
- A page with an exception before readiness is `page-failed` with the exception text, with no hang.
- The capture target never shows in the project browser pages, during or after.
- An itest of the operation through its door: a short page per the skill fragment, two frames, frame size and difference checks.
