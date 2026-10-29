---
id: 01a0d136-c444-7c55-b735-192d400289b2
title: "Add the row peek on hover and Space: full model, context, cache words, files, running processes, worktree, team summary, last line, and actions by state"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d138-dbb9-74e0-9449-ec3fdd5247d3",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0d136-c214-7131-a5e1-ff49fd277fc5
  - kind: waits-on
    to: 01a0d136-c409-74c8-b161-b53779b59d15
---
Build the peek of [[fd277fc5]] beside `ThreadRow.svelte`, moving Space off the activity panel (`onRowKey`) onto the peek and reusing the activity reading `ActivityBadge` holds. Actions call the operations the menu and the conversation already use and grey on their own row's act alone ([[46899e82]]). Tokens show when the row carries `contextTokens`. Done when hover and Space open the same peek and Allow in it answers an ask; rewrite [[35a9f05e]] from the code. Size: medium.