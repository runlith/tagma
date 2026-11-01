---
id: 01a1991b-afdd-734c-83ee-cd5227668518
title: Keep terminal projects separate from their holder threads when opening tabs
ord: 18
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19917-0235-76be-a812-9672f9ae9798",
    "status": "in_work"
  }
---
Fix opening an execution held by a thread homed in another project: navigate to the thread’s actual home and keep the terminal’s execution project in its tab identity, restore, closing and rendering. Prove the reported cross-project opening through the same terminal reveal operation, including a holder absent from the current list.