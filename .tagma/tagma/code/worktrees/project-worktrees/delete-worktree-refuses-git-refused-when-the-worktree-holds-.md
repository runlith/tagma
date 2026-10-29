---
id: 01a13f1a-6f7e-7ecd-80cb-aa397532b63d
title: delete_worktree refuses git-refused when the worktree holds an ignored .tagma path
ord: 26
tags: ["reflection"]
fields:
  {
    "actual": "refused git-refused at deletion-stage: \"The following paths are ignored by one of your .gitignore files: .tagma/runlith/tagma/env — Use -f if you really want to add them.\" The staging step adds an ignored path the graph wrote itself; no caller-side way out, since .tagma is the server's and may not be cleaned by agents.",
    "command": "delete_worktree {rootId: \"01a13e14-5a1b-7fd3-9aa5-830efafe5891\"}",
    "expected": "The throwaway detached worktree is deleted: uncommitted paths committed onto a kept branch, ignored files removed with the folder."
  }
---
Filed from project `runlith`.

Worktree was created by create_worktree (detached at b5ff50940b^) for a bisect, then moved with `git checkout --detach` to other commits; the graph server kept writing .tagma files into it (which also blocked later `git checkout` — git refused to overwrite the server's uncommitted .tagma files). The deletion's own stage step should skip ignored paths (or add them only when tracked) — the contract says ignored files go with the folder.