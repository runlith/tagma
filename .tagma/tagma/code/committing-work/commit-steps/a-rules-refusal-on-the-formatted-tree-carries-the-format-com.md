---
id: 01a16525-11fb-76ad-a279-6b1488cb5950
title: A rules refusal on the formatted tree carries the format-command shape into working files and names it; check_rules marks such files
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16520-e469-7511-971d-73957c75640b",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16520-c25f-7fe0-a260-bdc788ccb5a3
---
The rules judgment before hooks in submit_work and commit_checkout refuses on the post-format-command tree, while the working file stays in its previous shape: the agent cannot match the refusal's places and numbers. A refusal after hooks already carries the steps delta into working files; the first judgment did not, and `carriedSafely` dropped the steps delta when hooks changed nothing. Fix: the first judgment's refusal carries the steps delta as session lines and says the shape came from format commands; check_rules over the change names the files judged in that shape.
