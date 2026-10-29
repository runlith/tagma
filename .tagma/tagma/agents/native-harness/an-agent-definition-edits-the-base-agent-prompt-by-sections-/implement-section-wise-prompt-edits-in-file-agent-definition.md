---
id: 01a14688-af10-7cb2-b7e0-d5dbeeb1100e
title: Implement section-wise prompt edits in file agent definitions and the tagma-normrule agent
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14684-51e3-78d9-9920-85c558b903bf",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a14688-9ec2-7207-a19e-51e825ea1840
---
Implement [[25ea1840]]: the `SectionEdit` schema in the profile, `sections` parsing in frontmatter, application in prompt assembly, preview and run; contract tests; the personal `tagma-normrule` agent as proof. Done when the commit has landed, typecheck of the affected packages is clean, and preview on its own instance shows the edit.
