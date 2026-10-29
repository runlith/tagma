---
id: 01a16dee-3172-7a97-89e7-8231a4bf039d
title: Cheapen native-harness, install and provider tests
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16ded-dc54-7953-ba9c-9dd1e8cd9919",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16b01-cb85-7e31-9936-47664dbd9a84
---
Harness packet dissected: 172 files, one outcome per file in x10/x-harness.tsv; 33 changed, 139 kept as unit or real-boundary checks. 23 files deleted for 84.5 s CPU of baseline. Provider transitions moved to existing ThreadMemory and in-memory FileSystem under unit guards; summarizer choice moved to unit; projects and runs in start cost and compaction cut. For 33 changed files the before/after sum is 130.6 → 52.0 s CPU, but before comes from the quiet shared run and after from single runs under load: this proves no shared speedup. Whole packet before is 246.2 s by rounded lines; after and whole-packet factor stay with the quiet shared measurement, 139 unchanged files marked unmeasured for after. Changed tests passed seeds 1/2/3 separately. Fixed materialization of visible events on branch-source deletion: the existing forkPrefix reproduced UNIQUE thread_event.id on remove_project and passed after the fix in a07e81503e.
