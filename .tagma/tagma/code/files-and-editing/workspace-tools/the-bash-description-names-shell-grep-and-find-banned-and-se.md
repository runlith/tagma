---
id: 01a128e2-488e-7515-bbb1-04e8d35270cd
title: The bash description names shell grep and find banned and sends search to the grep and glob tools
ord: 40
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12852-29c9-75ef-81e4-9b204590c35f",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a128a5-e289-790a-b414-601856970fa1
sources:
  - kind: file
    ref: packages/agent-tools/src/descriptions.ts
---
An agent searched via `grep -rn … .` from the checkout root and stood on the command for minutes. The walk reads about 30 GB of what git ignores, while the `grep` tool on ripgrep answers in under a second. In the `bash` description, search was mentioned only under file writes; neither `grep` nor `find` was named.

Take the direct ban from opencode and Codex: the `bash` description names shell `grep`, `find`, and `ls -R` and sends search to the `grep` and `glob` tools. Search the tools cannot express goes via `rg`.

Done when the description is grounded and the server serves it.
