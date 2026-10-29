---
id: 01a13f4a-cba0-7420-8f47-1a047304d99c
title: CPU diagnostics never shows active filesystem watchers and the rescans they cause
ord: 9
tags: ["reflection"]
fields:
  {
    "actual": "The catalog offers no such operation: it answered delete_worktree, rename, check_law, check_worktree_merge, and install_plugin. The actual watcher roots and their share of current CPU stayed unknown.",
    "command": "tool_search for active filesystem watcher paths rescan counters.",
    "expected": "One standard operation showing live watcher roots, recursive flags, subscribers, and event/rescan counters, to tie fseventsd load to Tagma observation."
  }
---
Filed from project `runlith`.

To investigate, I had to read `platform/watch/tree.ts`, `workspace/watch/shared.ts`, and `graph/serving/freshness.ts` by hand; the actual watcher roots and their share of current CPU stayed unknown.
