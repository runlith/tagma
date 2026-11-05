---
id: 01a1a9c6-bea1-7048-aa54-c47483baccd9
title: The host bundle compiles a SQLite engine on platforms whose Bun embeds the selected one
ord: 73
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a928-24ed-7a10-a589-fa733c4dcf06",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a1a764-10de-7f61-9e76-e67b44a44563
---
`buildArtifact` (`packages/execution-host/src/buildArtifact.ts:180-218`) always calls `buildEngine` and packs `host/sqlite.native` as a `carrier` part, but `@runlith/sqlite-process` `engineFor` selects a supplied library only on macOS; on Linux the host runs Bun's embedded SQLite and never loads that part. On a cold Linux CI runner the compile takes about 28 s per host-bundle build (hostDeath.itest world, run 41960251520), paid by every lane that builds a bundle.

Done when the bundle carries the engine part only where the platform's engine supplies one — the decision read from the sqlite-process engine owner, not a second platform check — with the bundle verifier, the released logic's role reading (note 99e0a462) and the release cut's darwin targets unchanged, proven on Linux and macOS CI.