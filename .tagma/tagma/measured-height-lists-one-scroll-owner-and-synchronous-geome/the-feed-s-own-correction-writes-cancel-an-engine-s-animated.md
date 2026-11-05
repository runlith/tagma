---
id: 01a1a911-7b50-708d-a7c8-58d2a20d0989
title: The feed's own correction writes cancel an engine's animated wheel scroll and lose the rest of the reader's wheel
ord: 5
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a1a904-4572-76d1-bfa5-7f13b1b0a33c
  - kind: relates
    to: 01a18468-c1f0-763f-8d37-046c1fa34c88
  - kind: relates
    to: 01a1851a-39a3-760f-9292-7af698c0c0fe
sources:
  - kind: dir
    ref: packages/virtual-list
---
Linux WebKit (Playwright build 2311, headless WPE) animates each wheel scroll over later frames, and any programmatic scroll aborts that animation. In CI 41938545733 at e39fb8d4bc, judged by the settle-aware wheel oracle, every remaining WebKit wheel red is one of the feed's own `scrollTo` corrections landing mid-animation:
- fling-wheel: writes 49842→49715, 47297→47177 and 46320→46100 lost 167, 220 and 319 px of delivered wheel;
- page-mid-fling: the prepend rebase 2715→53636 at 12570 ms cancelled the wheel stamped 12546 ms, losing 116 px;
- rail-during-fling: 22 px.

Recordings are in scratch `wheel-settle-1` of thread 01a1a7b4-627a-71da-a64c-60c720cc7b7d. The reader loses scroll distance on any engine that animates discrete wheels.

The fix is a design decision, not an edit. [[1fa34c88]] keeps correction writes absolute and idempotent, because delta writes would apply a repeated target twice. [[98c0c0fe]] concluded that if any write loses input, the lever is not writing during a wheel stream and designing the wall a held prepend leaves. Reading [[2b40a488]] saw `scrollBy` lose no delivered wheel on macOS Playwright WebKit, where `scrollTop` and `scrollTo` did. It did not test an animated wheel.

Done when: WebKit fling-wheel, page-mid-fling and rail-during-fling pass on Linux under the unchanged oracle, and the Chromium lanes stay green.