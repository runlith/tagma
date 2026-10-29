---
id: 01a17088-63bc-70e8-ab1b-69d0dbb755d3
title: "read_artifact_frames loses the browser: Target.createTarget refused without remote debugging"
ord: 3
tags: ["reflection"]
fields:
  {
    "actual": "refused[page-failed]: the browser was lost while it opened the page: Target.createTarget was refused: Hidden target can be created only when remote debugging is enabled",
    "command": "read_artifact_frames {path: \"tagma-sting.html\", frames: [0,15,36,54,70,84,96,108,122,140,160,209]}",
    "expected": "The capture browser opens the page and returns the 12 PNG frames"
  }
---
Filed from project `runlith`.

The refusal arrives as `page-failed` with unblock "fix the page", though the exception belongs to launching the browser (CDP Target.createTarget with a hidden target and remote debugging off), not to the page: the page never gets to load. The page is a standalone HTML with timeline v1, data: fonts, and inline SVG, ~120 KB, in the scratch of thread 01a17086-443e-745b-b10e-4957e8a75582. The refusal code misclassifies the failure: editing the page won't clear it.
