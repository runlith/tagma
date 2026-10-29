---
id: 01a0d136-c501-7136-b21b-9b016baeb699
title: Group identical asks of one team into "N asks" with Allow all and Review one by one, and one-act launches into one "Title ×N" row
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d138-dc9c-78a5-9974-1e629459f2c2",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0d136-c2b1-74b0-a32d-d96ca4acd1ed
  - kind: waits-on
    to: 01a0d136-c587-7a98-89fb-a1b58847ca6b
  - kind: waits-on
    to: 01a0d136-c5cd-7ddb-b0e2-375737a0a3ab
---
Build the ask groups (by `spawnRootId` and `ask.key`, more than 3; Allow all only for `ask.kind` confirm, one answer per thread through `answer` / `answer_ask`) and the launch groups (by `bornOf`, more than one root; counted failures stay on the group row) of [[a4acd1ed]]. Done when the 12-asks and ×30 acceptance cases hold. Size: medium.

Known gap, found while building [[8847ca6b]]: `ask.key` digests the kind, the tool names and the prompt words. The same confirmation words can still name different acts, such as a swept bash shape's generic reason or the same command in another workdir. So one key may group asks that a single "Allow all" must not answer together. Resolve this before offering "Allow all": either narrow the key to the act the confirmation authorizes, or show the differing acts before the click.