---
id: 01a16154-c78c-728f-b9fa-a554b3e61738
title: delete of a tree outside any registered checkout answers one JSON line per file instead of its summary
ord: 104
tags: ["reflection"]
fields:
  {
    "actual": "613 lines / 94,920 characters of `{\"path\":…,\"status\":\"removed\",\"record\":\"outside\"}`, over the tool-output limit, spilled to a file the caller is told to read whole.",
    "command": "delete {args: [\"-rf\", \".git\"], workdir: \"/opt/workspaces/law-lab-plain\"} (no -v)",
    "expected": "A one-line summary like the earlier call in the same folder: \"Deletion completed: N removed, 0 absent, …\"."
  }
---
Filed from project `runlith`.

Same session, same folder, minutes earlier: `delete -rf .tagma tagma.config.ts checks` answered "Deletion completed: 41 removed, 0 absent, 0 skipped, 0 failed, 0 unprocessed, 0 unknown." The difference is that the folder had stopped being a registered project in between (remove_project), so every entry is `record: outside`. Non-verbose removal should summarize whatever the record says; the spill then demands the caller read 95k characters of file names.