---
id: 01a1a843-a75a-71ef-b7f6-1d46a12e8134
title: A click right after a shown managed page opens is sometimes lost
ord: 16
tags: ["task"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/managed-browser/host.ts
---
In `host.e2e.ts` run with `--headed`, the shown-agent identity test opens a page in a new window of installed Chrome, takes a snapshot and clicks the "Add" button with `act_on_page`. The click reports success, but the page counts 0 items. Three of about 20 headed runs on 2026-11-04 failed this way, each the first run after a pause or a code change; the runs right after it passed. Hidden profiles never failed.

The cause is not established. The pattern points to the first window of a cold Chrome not yet taking input when the click is dispatched. An agent that clicks right after `open_page` in a shown profile would lose that click the same way. Find where the input goes and make the host's act wait on the fact that the window takes input, never on a delay.