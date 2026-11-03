---
id: 01a1411a-c7a8-7e4d-8d8a-93fd24871a8d
title: A release cut keeps no predecessor and does not resume after the command limit
ord: 18
tags: ["reflection"]
fields:
  {
    "actual": "The command was killed by SIGINT after 3 minutes during trial, after building the signed DMGs and the archive. release.json not yet written; the previous 0.1.1 cut was deleted and kept only temporarily. A repeated cut will need a rebuild and will no longer find the predecessor.",
    "command": "CARGO_BUILD_JOBS=3 CMAKE_BUILD_PARALLEL_LEVEL=3 bun run tagma:release --version 0.1.2 --json",
    "expected": "The cut fits the standing 3-minute limit, or lets finished steps continue with no rebuild and no predecessor loss."
  }
---
Filed from project `runlith`.

The call ran in a clean worktree ~/.tagma-dev/worktrees/runlith/tagma-0.1.2-friend-20261015. Log ~/.tagma-dev/release/release.log: runtime 0.2s, program 2.9s, package 1.2s, tools 0.3s, surface 16.8s, speech engine 32.6s, revision 2.0s, executions 17.8s, sealing 1.8s, manifest 0.3s, desktop 40.0s. After packing, trial managed an install-from of the predecessor. The owner is installation/cut/pipeline.ts: previousCut, remove(out), trialStart, and recorded run as one unresumable chain. Notarization also runs two submit --wait and repacking as one chain with no intermediate result kept.
