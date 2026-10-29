---
id: 01a0d09f-1bf6-7559-85f2-6a187d2e8618
title: A builder rewrites checkout files through Python scripts in its scratch, around the edit and write doors
ord: 15
tags: ["reflection"]
fields:
  {
    "actual": "The shell refuses one literal path but runs a script that writes many, so the writes land unattributed and unchecked. A builder chose this for speed: one script per batch of replacements instead of dozens of edit calls.",
    "command": "bash: python3 <scratch>/t1.py, a script that open().write()s several files under /opt/workspaces/runlith (thread 01a0d021, 47 such runs, plus a scratch git worktree used for 273 calls)",
    "expected": "Checkout files change only through edit/write, so lines are attributed, prose comments stripped and concurrent edits refused. Where many replacements are needed, the door offers a batched edit."
  }
---
Filed from project `runlith`.