---
id: 01a17321-2895-71ed-b498-9b2a6362d09a
title: The vendor turn map and cut point have one owner for ACP and terminal; restore returns the replaced root
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17326-ef22-7865-b9a0-10ff558b36ba",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a17321-2895-71ed-b498-9b2711b4f93a
---
`protocol_turn` and `ProtocolRows.point/copy/trim/based/holds` move to the module's neutral owner; ACP switches to it with no behavior change. The row carries the root and an opaque cut address. A replaced generation is added: restore after an executed cut returns X — on ACP too, instead of assembling a session from the journal.
