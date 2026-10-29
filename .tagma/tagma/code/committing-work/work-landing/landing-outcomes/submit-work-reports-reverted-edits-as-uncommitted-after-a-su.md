---
id: 01a12814-f02f-7d87-affa-c9bffa037c2b
title: submit_work reports reverted edits as uncommitted after a successful landing
ord: 13
tags: ["reflection"]
fields:
  {
    "actual": "Commit e6ef21f468 landed; the answer declared semgrep/adapter.ts, plugins/registry.ts, and a number of other rolled-back paths uncommitted. Right after it read_changes reported 0 held paths, and git diff on those paths is empty.",
    "command": "submit_work({subject: \"Use Schema.optional where absence has no independent meaning\", whole: true})",
    "expected": "After landing, left names only paths with truly uncommitted lines of this session."
  }
---
Filed from project `runlith`.
