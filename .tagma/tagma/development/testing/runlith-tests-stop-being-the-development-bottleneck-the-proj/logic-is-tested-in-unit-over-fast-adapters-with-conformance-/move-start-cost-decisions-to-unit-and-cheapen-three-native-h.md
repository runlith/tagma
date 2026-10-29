---
id: 01a16e69-2dbd-78a6-ae33-9fb32f39a080
title: Move start-cost decisions to unit and cheapen three native-harness files by profile
ord: 28
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16ded-dc54-7953-ba9c-9dd1e8cd9919",
    "status": "done"
  }
---
Three CPU profiles taken before changes and kept in scratch x-harness. startCards decisions checked in unit over existing aggregate/HarnessThreads and memory; the itest leaves one root and one request with real prompt, preview and guidance cost. The summarizer choice matrix moved to the ChoiceReader unit; real invalidation→checkpoint→continuation preserved. Both non-code projects use the owner's fixtures knowledgeProject without git init: git children compaction 62→54, activity 31→22. All five test files passed seeds 1–3 separately; typecheck passed. Profiled before of three itests: 18.8/6.7/7.3 CPU s; latest cold samples: 8.0/5.5/5.5 CPU s, two more units 0.7/0.4 CPU s. These are different conditions and instrumentation, no proven factor; the shared quiet total stays with the parent work. Ledger: x10/x-harness.tsv. All lines landed in 060f22d321 and c23c5ca782, held paths = 0.
