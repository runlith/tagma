---
id: 01a1651f-aae8-74f6-8dc3-5c52517da264
title: "A CLI session stop carries the `stopping` mark through with the driver that saw it: a driver started before the mark may never read it"
ord: 5
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a16519-471e-7683-96c8-edf22c1b1683
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/sessions/drive.ts
---
`SessionDriver.stop` marks the session `stopping` and hands it to its driver (`attend`). `attend` launches nothing while the previous driver still stands in `FiberMap`. The previous one may already be finishing: for example, a launch that failed after the start was sent and marked the session `uncertain`, and is now handing it over. Such a driver no longer reads the `stopping` mark.

So the stop waits out the previous driver, and if the session is still `stopping`, starts its own and waits for it: this driver started after the mark and must handle it. Without this, the stop refused with `session-uncertain`, though the session could have been ended. A failure before the start is sent (on an already deleted project, for example) needs no such handover: the launch itself ends the `stopping` session as `aborted`.

The second driver is not a rerun of the failed act — it is the first driver that saw the mark. More than once is never needed.
