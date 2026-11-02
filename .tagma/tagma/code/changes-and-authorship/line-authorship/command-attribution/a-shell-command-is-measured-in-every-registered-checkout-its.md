---
id: 01a199e3-b937-77b6-8aa6-49967d67ce4b
title: A shell command is measured in every registered checkout its line reaches, not only the session's own
ord: 26
tags: ["task"]
fields:
  {
    "holder": "tagma:01a199d9-09ab-7353-801f-8a47481ff65d",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a116e8-e341-7861-a5f6-564c65835438
---
A command measured only the session's own checkout: a `cp` into a sibling project, a generator run with `workdir` in another registered checkout, or `cd` into a group member left every line it wrote there nobody's, though the change record opens a window in any registered checkout and the line named those paths.

The bash kit measures each registered checkout the line can author in: its workdir's, each directory it `cd`s into, and each checkout a named path falls in; the change record's answer to `command(tree)` decides which trees are registered. A repository no project registers stays unmeasured and the answer says so. A checkout the line never reaches is not measured: a window alone never authors, so measuring it would buy no line and cost a reading per command.