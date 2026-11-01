---
id: 01a1958c-2c61-79c2-a0ae-eb49640ec624
title: A sliced manifest carries peer entries without their sample files
ord: 184
tags: ["reflection"]
fields:
  {
    "actual": "Commit 0674a33fe0 carried two live peer manifest entries without their sample directories, leaving the committed manifest pointing to missing samples.",
    "command": "submit_work({\"subject\":\"fix(dom): retire static event handlers with their owner\",\"body\":\"Release direct and delegated static event handlers when their rendering owner is destroyed, even if an application retains the detached element. Preserve the documented ordering and cancellation of native input listeners relative to delegated handlers.\"})",
    "expected": "Land my manifest entries with their samples while leaving unrelated peer entries out, or carry each peer entry together with its required sample files."
  }
---
Filed from project `vigla`. Received by a server up since 2026-11-01T04:35:00.962Z, from b555dcaa0.

The answer named `harness/manifest/own/runtime.json` under carried lines of thread 01a19457-e130-796d-8f16-56fc8fa1a3c9. `git show 0674a33 -- harness/manifest/own/runtime.json` contains `issue-15627-outro-derived` and `issue-4389-crossfade-reversal`, while the eight committed paths contain neither corresponding sample directory. The harness checks manifest entries against sample directories, so an unfiltered `own/runtime` run cannot pass from that commit. The two peer entries were not selected for the landing.