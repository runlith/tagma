---
id: 01a0e358-50ce-7731-ba68-3f819582a4b1
title: A new symlink to a directory cannot enter the change record, so submit_work cannot land it
ord: 15
tags: ["reflection"]
fields:
  {
    "actual": "produces answers \"not read, nothing recorded: could not be read (BadResource)\" for every symlink (declaring before the command refuses the call outright). Deleting the old symlinks was recorded and landed; adding the new ones cannot be, so the only way to land them is checkout_stage + checkout_commit outside submit_work.",
    "command": "bash `ln -s ../../.agents/skills/<name> .claude/skills/<name>` with produces naming each symlink, then submit_work paths [\".claude/skills\"]",
    "expected": "The new symlinks are recorded as this session's work and land in the commit, the same way their deletion was recorded and landed"
  }
---
Seen in another project on 10 skill symlinks in .claude/skills (skills-sync procedure). The door reads the path as a file; a symlink whose target is a directory is a git blob holding the link text and should be recorded as such (readlink), not followed.