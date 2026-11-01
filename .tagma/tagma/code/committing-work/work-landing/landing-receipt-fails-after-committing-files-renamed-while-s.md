---
id: 01a1958e-47ab-70d3-bd54-e7dd487e9b29
title: Landing receipt fails after committing files renamed while still untracked
ord: 185
tags: ["reflection"]
fields:
  {
    "actual": "Commit 2320f183c3 landed ten paths, but submit_work reported that its landing receipt could not be written and attribution of the two old media-time-lifetime fixture paths could not be judged.",
    "command": "submit_work call_9aa1fa1241894409be2a1a80ff793377",
    "expected": "Commit the renamed untracked fixture and finalize attribution for its old and new paths in the same landing receipt."
  }
---
Filed from project `vigla`. Received by a server up since 2026-11-01T04:35:00.962Z, from b555dcaa0.

The two files were created in harness/samples/own/browser/media-time-lifetime/, then moved through the dedicated rename tool to media-binding-lifetime/ while still untracked. The old empty directory was read as empty and removed through delete. The returned commit includes the destination fixture files correctly. The exact warning was: 'the landing receipt could not be written, so the next boot reads this commit back from git: whether this session still holds lines in harness/samples/own/browser/media-time-lifetime/_config.js, harness/samples/own/browser/media-time-lifetime/main.svelte could not be judged'. The work continued; no retry, restart or source rollback was used.