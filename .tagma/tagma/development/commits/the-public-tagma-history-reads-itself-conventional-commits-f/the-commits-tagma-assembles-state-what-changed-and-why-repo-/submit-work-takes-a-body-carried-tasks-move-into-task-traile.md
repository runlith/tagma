---
id: 01a180c0-3848-77f5-805f-e4246e9ff397
title: submit_work takes a body, carried tasks move into Task trailers, Tagma co-authors agent commits, and merge_worktree joins one trailer block
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a180c0-b278-7f4a-8ba3-42eeeb5efeac",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a17f5f-3c8d-78c2-b6c7-2ab1c11265c5
---
The agent-commit half of [[c11265c5]]: a separate body beside the subject, one `Task: <name> <title>` trailer per carried task instead of the subject suffix, `Co-authored-by: Tagma <agent@tagma.dev>` on every `submit_work` and `merge_worktree` commit with a project setting, on by default, that removes it, and one trailer block in `git interpret-trailers` shape that `Tagma-Worktree` joins. Doctrine states the body in one line.