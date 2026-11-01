---
id: 01a19936-6251-7bd4-801d-8abdf978d418
title: Report and settle a headless e2e hang instead of leaving its worker alive
ord: 32
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19917-0235-76be-a812-9672f9ae9798",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1991b-afdd-734c-83ee-cd5227668518
---
A terminal e2e reached the three-minute guard while a PTY lane was open, lost its execution host, and continued unavailable-host retries without a verdict; another run settled without failure evidence. Preserve failure evidence before resource release and settle the worker without changing the hang bound. Verified on Bun 1.4.4: the committed Chromium regression failed before the native-timer fix and passed on seeds 1–3 after it; recorder failure, deadline and interruption checks, testbed lifecycle checks and affected package typechecks passed. A removed, one-off real-clock Chromium probe reported `test timed out after 180000ms`, settled in 180.4 seconds, saved a readable screenshot, console log and valid trace archive before context cleanup, completed its process-cleanup hook and reported zero process residue.