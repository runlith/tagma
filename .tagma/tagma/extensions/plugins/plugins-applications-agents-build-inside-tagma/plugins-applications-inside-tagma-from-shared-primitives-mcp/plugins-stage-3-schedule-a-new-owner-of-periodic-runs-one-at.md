---
id: 01a12333-d249-70fe-bcc8-9def5ab2fae5
title: "Plugins, stage 3: schedule — a new owner of periodic runs, one at a time, missed ticks do not accumulate"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12333-ebb2-7cc2-b501-4136875a6d2f",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1227f-7522-78e3-a658-79b7a0a16218
---
The spec's “Contribution points by stage” section → “Schedule”: a small new owner (recap is not it). One run at a time; ticks missed during machine sleep or server stops do not accumulate — after waking one run goes; a failure and the next run's time are visible; it does not keep the machine awake. A tick reaches the recipient as a Tagma event — for a plugin it is a tool call with caller `tagma {reason}` (`590da89125`). Here the owner and its contract with the recipient port; connecting the manifest `schedule` point to the `plugins` module is separate, once its fixes on review land.

Done when a controlled-clock test shows: a scheduled tick is delivered; a long run does not overlap the next; after skipping N ticks (sleep or stop) exactly one run goes; a recipient failure is visible in the state with the next run's time; the schedule survives a server restart.
