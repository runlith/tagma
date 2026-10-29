---
id: 01a18590-1ad2-74ba-849c-8105cf60e489
title: The screencast cursor scenario hangs under TestClock once earlier tests in its file have run for a while
ord: 37
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18547-c530-7893-af7a-adb0a9d1893c",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a18547-5d77-7c50-9b9e-ce814125340a
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/testing/screencast.ts
---
The screencast scenario "viewer input holds agent steps until it is quiet, and the agent cursor reaches viewers but no capture" (`browser/testing/screencast.ts`, run by `managed-browser/screencast.itest.ts`) intermittently hangs to the 3-minute guard. After the guard, testbed kills the profile browser, so the following tests in the file fail with `host-away` (`Failed to open a new tab`) or `outcome-unknown` (CDP transport ended).

Observed (Apple M2 Max, Chrome for Testing from the test cache, 2026-10-29):
- The hang needs only real time elapsing in earlier tests of the same file. With both recording scenarios replaced by "open a page, sleep 5 s", it still hung once in five seed-2/3 runs. With those two tests filtered out, it passed four of four.
- With the recording scenarios in place, about two of ten seed-2/3 runs hung.
- The hang point varies. Once no screencast frame ever reached the viewer after `watching`. Once frames arrived, the viewer's click went through, and the next `act_on_page` (expected to refuse `operator-input`) never answered.
- The test provides `TestClock` to its whole body. Every engine fiber forked from it (the screencast keep loop, the 1 s first-picture fallback in `restart`, guard steps) runs on the frozen clock, while the drive sweep and host timers run on the real one. `state.used` written under TestClock is near 1970, so a real-clock sweep reads every such page as idle.

Not established: which waiting step never completes. Adding `console.error` traces made the hang disappear in every run.

Done when the scenario cannot hang on how long earlier tests ran, proven by seeds 1/2/3 with a real-time sleep before it. A likely direction is to stop running engine fibers under TestClock: move time only where the test needs it (the 5 s operator hold, the 2 s cursor linger), or measure those spans as real waits.
