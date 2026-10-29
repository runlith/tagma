---
id: 01a11ca5-7ddf-7f42-a891-bd6686d3a9ca
title: "Terminal thread on core: row and journal, turn as run, observed, ending by Stop and transcript, questions and reports; session migration and rollout steps"
ord: 17
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14dd1-43cd-7723-af0a-5cf815955c6a",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a11c9a-6edb-7ed8-b517-60b0a621fbb3
  - kind: waits-on
    to: 01a11ca5-7ddf-7f42-a891-bd632d80ffd6
  - kind: waits-on
    to: 01a11ca5-7ddf-7f42-a891-bd659b043055
---
What: [[a621fbb3]] in full, cut 3 of [[a63eba68]], the `hook` channel of `RunGuidance` in [[2121a95f]]. Plus: facet readers that decide acp/terminal by facet (`onAcp`, `facetTransport`, SQL `acpFacet`, ~25 places) move to the core-row binding once the terminal has one. Split into subtasks when its turn comes.

Proof: the [[a621fbb3]] criteria and the [[a63eba68]] migration test.
