---
id: 01a13276-a5d7-7e79-980d-b887e77973ab
title: "#experiment"
ord: 15
tags: ["tag"]
fields:
  {
    "body": {
      "shape": "content"
    },
    "edges": [
      "validates",
      "relates"
    ],
    "fields": {
      "status": {
        "type": "enum",
        "values": [
          "planned",
          "running",
          "done",
          "dropped"
        ]
      },
      "verdict": {
        "type": "enum",
        "values": [
          "confirmed",
          "refuted",
          "unclear"
        ]
      }
    },
    "gates": [
      {
        "field": "status",
        "from": "planned",
        "gate": "transition",
        "to": "running"
      },
      {
        "field": "status",
        "from": "running",
        "gate": "transition",
        "to": "done"
      },
      {
        "field": "status",
        "from": "planned",
        "gate": "transition",
        "to": "done"
      },
      {
        "field": "status",
        "from": "planned",
        "gate": "transition",
        "to": "dropped"
      },
      {
        "field": "status",
        "from": "running",
        "gate": "transition",
        "to": "dropped"
      },
      {
        "field": "status",
        "from": "done",
        "gate": "transition",
        "to": "planned"
      },
      {
        "field": "status",
        "from": "dropped",
        "gate": "transition",
        "to": "planned"
      }
    ],
    "id": "experiment",
    "roles": {
      "status": {
        "closed": "dropped",
        "done": "done",
        "field": "status",
        "initial": "planned"
      }
    },
    "sources": [
      "file",
      "dir",
      "symbol"
    ]
  }
---
An #experiment is one run on a synthetic project that tests how Tagma, or an agent in it, behaves. The body:
- **Hypothesis** — one sentence the outcome can refute.
- **Setup** — the polygon commit, rules, settings, the agent's task verbatim, model and reasoning: enough to repeat the run from the same state.
- **Observation** — what happened, with links to the agent's thread, commits and feed entries; what was measured kept apart from what is inferred.
- **Conclusion** — what was confirmed, what was not, and what the run did not test.

`verdict` is set on finishing; dropped means the run was cancelled. A Tagma defect the run finds is a separate task, discovered-from the experiment. Nothing about the experiment is written into the polygon's own graph: the polygon's agents read it.