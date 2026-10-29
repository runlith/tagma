---
id: 01a16eb4-68ee-71ac-8ad5-b36685502ed7
title: Exclude test reports from the host bundle key without losing build freshness
ord: 41
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16ded-dc54-7953-ba9c-9dd1e8cd9919",
    "status": "done"
  }
---
Exclude test reports from the host bundle key through a positive selection of configurations and their dependencies; preserve freshness of src/drizzle/native/toolchain and publication refusal over unhashed bundler inputs. The owner is the execution-host build; the description is updated in [[3634462d|machine cache contract]].

Reproduction through a real cachedArtifact around generation.test.ts: of 524 hashed files only packages/execution-host/.bun-test-timings.json changed; key fc0515dd… became f8eff6ae… with the same bundle digest. Two calls gave two miss-builds. After the fix 518 files hashed, including transitive packages/tsconfig/bun.json and base.json: key e4c0212f… after the test unchanged, one cold build then a hit. Key snapshots, SHA256 of each input and measurement probe sources kept in this work's scratch.

Full integration before: 564 tests/96 files, 82.9 s CPU and 280.6 s wall, one worker; after: 565/97, 92.9 s CPU and 149.2 s wall, two workers. In both finished runs the machine cache was warm: 0 miss-builds and 1 direct bundleBoot build. This is no CPU-speedup measurement. The single-threaded after was cut by the five-minute limit on 90 files (87.8 s CPU, 1 miss); six package.json files changed between snapshots, so this run gives no controlled comparison. The source before-report already dropped testbed; the total stayed in the command output 24a9da32-d0d2-4ffe-95c6-141eca49b2ad:167, the full after-report kept in scratch.

Regression first failed with BuildRefused/PermissionDenied after the report change. The green case through the public operation checks a hit, separate transitive JSONC config and source changes, publication refusal of JSON outside src. It and hostExit/logicSwap consumers passed seeds 1–3 separately; bun run typecheck green. Independent review caught a dropped jsconfig.json: behavior confirmed by the installed Bun 1.4.3 resolver and a separate red; jsconfig.json included in the same recursive walk. After the finding fix all three files green again separately on seeds 1–3, typecheck green. Ledger: x10/x-harness.tsv.
