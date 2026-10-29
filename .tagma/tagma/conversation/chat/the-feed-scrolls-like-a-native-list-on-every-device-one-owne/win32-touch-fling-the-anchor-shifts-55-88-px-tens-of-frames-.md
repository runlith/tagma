---
id: 01a184b9-eba1-78b3-9f4d-1f5d92951645
title: "Win32 touch fling: the anchor shifts 55–88 px tens of frames after a history prepend"
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18355-1f4c-7eaf-a7b4-c56cc81b6145",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a18353-fb8c-7866-916b-78b406aa5d8d
  - kind: implements
    to: 01a18327-c7aa-7718-b037-fece2ea21922
sources:
  - kind: file
    ref: packages/chat-ui/src/TranscriptVirtualizer.svelte.ts
---
The stand's Chromium page-mid-fling scenario on the non-iOS branch (`navigator.platform = 'Win32'`) fails quiet-anchor checks after the older page lands during a touch fling. The quiet anchor moves 55–88 px in one frame, 39–115 frames after the prepend rebase (about +50955 px). Blank and rail stay 0. Base cad33548 fails the same way: run.47559.1793227918345 shows 88 px at frame 39 and 77 px at frame 64. The tree with the long-frame changes fails too: 55 and 60 px at frames 114–115. The scenario passed in run.18570, before the stand's recorder began capturing touchend on the original contact target. So the recorder fix probably exposed a feed defect that already stood; that is not yet proven.

Cause, read from the frame and input records of the four A/B runs (base run.47559.1793227918345 and run.49265.1793227986052; current run.50623.1793228032758 and run.51719.1793228070613): in every run the failing frame is the first sample after a `scrollend` that Chromium fires 0.1–0.9 ms after the feed's own `scrollTo` (a size correction for a row mounted above the reader during the fling), while the compositor fling goes on — scroll events keep coming with smoothly decaying deltas and no input. The recorder ends reader movement on any `scrollend` (`stand/recorder.ts`, the `scrollend` listener clears `ownMovement`), so the checker judges the rest of the fling as quiet. The failing frame spans a long main-thread task (83–125 ms) during which the fling moved the screen 55–88 px, and every sentinel moved rigidly by the scroll delta. On host the library takes MacIntel with touch points for iPadOS WebKit, holds corrections through momentum and writes nothing mid-fling, so no such `scrollend` arrives and host passes. The owner is the stand: movement the owner did not cause is the reader's, and a `scrollend` that answers the owner's own write does not end a fling. The writes land and the screen stays rigid, so neither the feed nor virtual-core moved the anchor. Fix at the recorder: end reader movement only at a `scrollend` that no own write preceded in the same task, or when scroll events stop. The long frames themselves (the page landing mid-fling at 4×) are the frame budget of d7dbe006.

First establish, from the frame and input records, what moved the anchor in that frame: a correction write and its read-back, a window change, a late measurement, or the fling itself. Then decide whether the defect is in the feed, the library or the stand. Fix it at its owner. Proof: Win32 page-mid-fling is green over seeds 1/2/3 at anchor ≤0.5 px, and host stays green.