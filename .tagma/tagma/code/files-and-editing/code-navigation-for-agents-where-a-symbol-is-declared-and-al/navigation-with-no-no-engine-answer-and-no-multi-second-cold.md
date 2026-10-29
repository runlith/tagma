---
id: 01a16403-be0b-7926-b159-d9b22eb85f6b
title: Navigation with no "no engine" answer and no multi-second cold start after idle
ord: 32
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16404-90d6-734e-9f24-aaa962b09c4a",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1612d-2135-7f12-8deb-91b934378e8f
---
Operator decision: the tool exists for all agents or for none — by design there is no "no engine" answer. It currently happens in three cases, all deliberate: a machine under ~10 GB of memory (`budget.ts` → `denied`), all engine slots taken (`holder.ts`, `admit`), a pause after an engine crash (`resting`). The engine also stops after 15 minutes idle, and the next question pays a cold start (on runlith the first heavy question after start is 11 s live, 13–26 s to first answer in agent measurements). Do per spec: the question waits for its engine (slot, restart), the engine runs on any machine with a smaller memory limit, a repeating crash is a failure with a diagnosis; a post-idle question has no multi-second cold start at low idle memory — the device is chosen by measurement.
