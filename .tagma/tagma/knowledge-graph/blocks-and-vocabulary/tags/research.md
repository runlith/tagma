---
id: 01a0bf8d-deac-78b9-880b-e99112bde0d1
title: "#research"
ord: 10
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
      "source": {
        "name": "researchSource",
        "type": "schema"
      }
    },
    "gates": [
      {
        "field": "source",
        "gate": "required"
      }
    ],
    "id": "research",
    "identity": {
      "shipped": {
        "export": "research",
        "library": "software-development"
      }
    },
    "roles": {},
    "sections": [
      {
        "key": "research",
        "text": "A #research node records a reading of a system outside this project; `source` names the system and the checkout, URL or version read. Separate observation from inference and say what the evidence does not establish; a measurement whose experiment was not kept says so: the record alone cannot reproduce it. Split a broad investigation by independent questions. A node resting on a reading relates to it and carries the versions and conditions it established, never a generalized result. Research says nothing about whether this project implements what it studied."
      },
      {
        "edits": [
          "append"
        ],
        "key": "project",
        "text": ""
      }
    ]
  }
---
A #research node records a reading of a system outside this project; `source` names the system and the checkout, URL or version read. Separate observation from inference and say what the evidence does not establish; a measurement whose experiment was not kept says so: the record alone cannot reproduce it. Split a broad investigation by independent questions. A node resting on a reading relates to it and carries the versions and conditions it established, never a generalized result. Research says nothing about whether this project implements what it studied.