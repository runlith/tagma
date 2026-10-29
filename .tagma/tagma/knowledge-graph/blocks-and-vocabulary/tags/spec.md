---
id: 01a0bf8d-de77-732e-b054-b9770d47cb37
title: "#spec"
ord: 4
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
          "open",
          "closed"
        ]
      }
    },
    "gates": [
      {
        "field": "status",
        "from": "open",
        "gate": "transition",
        "to": "closed"
      },
      {
        "field": "status",
        "from": "closed",
        "gate": "transition",
        "to": "open"
      },
      {
        "gate": "open-children",
        "tag": "task"
      }
    ],
    "id": "spec",
    "identity": {
      "shipped": {
        "export": "spec",
        "library": "software-development"
      }
    },
    "roles": {
      "spec": true,
      "status": {
        "closed": "closed",
        "field": "status",
        "initial": "open"
      }
    },
    "sections": [
      {
        "key": "spec",
        "text": "A #spec agrees a change the operator asks to have specified, before it is built. It stands under what it changes: a module, a capability, or the part when it spans the part. It thinks through what stands and what will stand: outcome, owners and boundaries touched, reason for the choice, checkable acceptance criteria. Split independent specs into children. Edit it in place when what is wanted changes: it always says what is wanted now. Closing its tasks does not close it: whoever ends its last task, or led its work, closes it once built, or once no longer wanted — the answer of finish_block, close_block or apply_batch that ends a task names the spec left with no open work, in this project or another. A closed spec is history, never current knowledge."
      },
      {
        "edits": [
          "append"
        ],
        "key": "project",
        "text": ""
      }
    ],
    "sources": [
      "file",
      "dir",
      "symbol"
    ]
  }
---
A #spec agrees a change the operator asks to have specified, before it is built. It stands under what it changes: a module, a capability, or the part when it spans the part. It thinks through what stands and what will stand: outcome, owners and boundaries touched, reason for the choice, checkable acceptance criteria. Split independent specs into children. Edit it in place when what is wanted changes: it always says what is wanted now. Closing its tasks does not close it: whoever ends its last task, or led its work, closes it once built, or once no longer wanted — the answer of finish_block, close_block or apply_batch that ends a task names the spec left with no open work, in this project or another. A closed spec is history, never current knowledge.