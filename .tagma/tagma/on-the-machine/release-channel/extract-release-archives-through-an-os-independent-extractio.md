---
id: 01a1a821-d156-742e-9fda-5e8d4abc0c7b
title: Extract release archives through an OS-independent extraction contract
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a814-ff9b-7d00-88c6-a374e602bb66",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/release-channel/archive.ts
---
Replace the shared release channel's macOS-only tar command with a portable extractor over its existing streaming decoder, preserving ordinary contents, modes and internal links while leaving archive ownership, xattrs, ACLs and file flags unapplied. Commit `609f59e0bc` implements this as one scoped worker operation; cancellation aborts input and joins remote completion before staging cleanup. The original Linux `NextInstallation.install` journey failed on GNU tar's `--no-mac-metadata` refusal. At that commit, the three archive cases and the complete channel journey pass on [Ubuntu CI 41905990175](https://github.com/runlith/tagma/actions/runs/41905990175) and [macOS CI 41905997495](https://github.com/runlith/tagma/actions/runs/41905997495), both on shard 5; the journey includes failed extraction and cancellation after materialization, with unchanged current and removed staging. Active mid-materialization interruption has static ownership review rather than a deterministic runtime case. Package typecheck passed, and independent review found no actionable finding. The workflows have failures outside these two suites; neither suite is platform-marked.