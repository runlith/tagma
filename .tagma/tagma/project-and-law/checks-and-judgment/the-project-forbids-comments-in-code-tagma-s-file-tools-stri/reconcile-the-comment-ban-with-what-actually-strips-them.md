---
id: 01a14c37-8ddf-7ed3-8933-b73f7f8e34cb
title: Reconcile the comment ban with what actually strips them
ord: 1
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a14c14-a11c-7ce8-9d84-633db6de3aa7
---
The `writing.comments` hint and the comment law say the door landing the change strips any added comment. Only Tagma's file tools strip them (`withoutAddedProse` in write, edit, and file import — the native agent and CLI over ACP). Terminal CLIs' own writes, bash, and the operator's editor keep comments; `submit_work` doesn't check them. Either strip where promised or narrow the text to the truth.
