---
id: 01a17129-809e-7fe0-9657-4bb8a99954a1
title: Project link `[[project:<id>|name]]` and dragging a project into the composer or CLI terminal from the strip, tabs, and project list
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17100-a232-7a0a-a781-94f0e2744109",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a17111-30e4-732c-a5ec-e0f64b005c71
---
The operator drags a project from the projects strip on the left, from project tabs on top, or from the projects popup, and drops it onto the composer or a CLI thread's live terminal — the same way as a thread from the column. There was no project-link syntax; it is introduced on the operator's word.

The link is `[[project:<id>|name]]`: the id of the registered project, which every `project` field accepts, and the name for reading. The agent learns it from the Answering section of its instructions, and the feed and the operator message draw it as a project link. In the composer the project is a mention chip with a project label; in the draft it is a `DraftMention` named `project:<id>`.
