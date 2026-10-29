---
id: 01a17fcf-ad2b-7433-af11-02b7cc7fb830
title: "relates is a core edge: any block holds it, an untagged note too, in its own project and with another project"
ord: 122
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17fc8-0671-75ed-a96c-0dcde5588d5c",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-692e4ad9de5e
---
Operator decision of 2026-10-28: `relates` carries no catalog meaning — it is just "these two things are connected". So any block holds it without declaring, like `discovered-from`, in its own project and with another project's block. A tag's declared target restriction for `relates` keeps applying.

Now an untagged note gets an `edge-undeclared` refusal in `create_block` and `link_blocks`, including in a project with only the core catalog. Yet untagged notes carry codeless projects, notebooks, and newcomers.

Fix the declaration and tag-change check, the tool descriptions, and the core catalog text, and record the decision in the edges feature.
