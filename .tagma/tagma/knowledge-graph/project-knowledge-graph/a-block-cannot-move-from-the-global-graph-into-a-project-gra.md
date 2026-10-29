---
id: 01a13aed-fcff-76de-ac35-5802ae2d5ebd
title: "A block cannot move from the global graph into a project graph: no move door, and supersede refuses across graphs"
ord: 183
tags: ["reflection"]
fields:
  {
    "actual": "refused[cross-project]: this act cannot join blocks stored in different project graphs; the only road was a hand-written copy in runlith plus delete_block in global, so the new rule carries no provenance edge to the old one.",
    "command": "supersede_block {oldId: \"c2f04d22\", withId: \"c826fe6a\", project: \"global\"} after create_block of the copy in project runlith",
    "expected": "One act relocates a rule mis-scoped into the global graph into the project that owns it (or supersede links the copy), keeping its history."
  }
---
Filed from project `runlith`.

The operator asked to move a global rule (written for the frontend `@runlith/layer` classes) under the runlith frontend. Two acts and a body rewritten by hand; the global block's log and the link between the two are lost.