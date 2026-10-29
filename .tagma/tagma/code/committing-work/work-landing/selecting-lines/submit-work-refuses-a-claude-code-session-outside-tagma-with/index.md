---
id: 01a14565-840f-75d8-a371-0a81df1cf4a1
title: submit_work refuses a Claude Code session outside Tagma with no-record, and the commit goes by hand via git commit -- <paths>
ord: 9
tags: ["reflection"]
fields:
  {
    "actual": "no-record: \"this session wrote through another harness, so no record says which lines are its\"; unblock — git commit -- <paths> by hand. Before it, read_changes without arguments also refused no-record. Commit 62a318b8ff was made by hand, past the commit steps and the rules judgement.",
    "command": "submit_work {paths: [19 files of this session], checkout: \"/opt/workspaces/runlith\", subject: \"fix: …\"}",
    "expected": "The commit of the explicitly named paths: the description promises that explicit paths also select changes nobody holds."
  }
---
Filed from outside every registered project.
