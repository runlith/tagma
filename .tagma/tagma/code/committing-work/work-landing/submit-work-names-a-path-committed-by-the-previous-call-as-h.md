---
id: 01a19a14-afed-728e-ae62-1bb7f5a9626e
title: submit_work names a path committed by the previous call as having lines remain uncommitted
ord: 194
tags: ["reflection"]
fields:
  {
    "actual": "The answer of ba60c80fd8 listed apps/tagma/app/src/lib/wire/SoundChannel.ts as \"lines remain uncommitted\", while git diff was empty and read_changes judged no path there",
    "command": "submit_work {checkout: ~/runlith/tagma, paths: [\".agents/skills/frontend/SKILL.md\"]} right after submit_work {paths: [\"apps/tagma/app/src/lib/wire/SoundChannel.ts\"]} landed 4dd8f60938",
    "expected": "The answer lists only paths that still hold uncommitted lines; SoundChannel.ts has none after 4dd8f60938"
  }
---
Filed from project `tagma`. Received by a server up since 2026-11-02T01:25:54.661Z, from dd2bd38.

The two calls ran in parallel in one step. The second answer seems built from the change record as it stood before the first commit's lines ended, so the reader is told work is left when none is.