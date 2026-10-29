---
id: 01a0cad6-b0a2-7073-8e29-5398b334a875
title: A paused guest reads `stopped` and is offered a `start` Docker refuses
ord: 1
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/sandbox/engine/docker/backend.ts
---
`DockerSandboxes.inspect` maps every non-`running` state — paused, restarting, dead — to `stopped`. A paused guest is therefore offered `start` on lease restart, which Docker refuses (`Container is paused`), surfacing as unavailable. Nothing in Tagma pauses a guest, so the trigger is an external `docker pause` — but once paused, no road unpauses: the guest never resumes.

Done when the paused state is read distinctly (unpause-then-start, or a refusal naming pause instead of an opaque unavailable).