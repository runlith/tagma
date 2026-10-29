---
id: 01a0bf8d-de80-78c7-a7ee-5be71f6ed1c7
title: "#task"
ord: 5
tags: ["tag"]
fields:
  {
    "body": {
      "shape": "orientation"
    },
    "edges": [
      "validates",
      "relates",
      "waits-on",
      "implements"
    ],
    "fields": {
      "holder": "session",
      "status": {
        "type": "enum",
        "values": [
          "open",
          "in_work",
          "done",
          "closed"
        ]
      }
    },
    "gates": [
      {
        "field": "status",
        "from": "open",
        "gate": "transition",
        "to": "in_work"
      },
      {
        "field": "status",
        "from": "open",
        "gate": "transition",
        "to": "done"
      },
      {
        "field": "status",
        "from": "open",
        "gate": "transition",
        "to": "closed"
      },
      {
        "field": "status",
        "from": "in_work",
        "gate": "transition",
        "to": "open"
      },
      {
        "field": "status",
        "from": "in_work",
        "gate": "transition",
        "to": "done"
      },
      {
        "field": "status",
        "from": "in_work",
        "gate": "transition",
        "to": "closed"
      },
      {
        "field": "status",
        "from": "done",
        "gate": "transition",
        "to": "open"
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
    "id": "task",
    "identity": {
      "shipped": {
        "export": "task",
        "library": "software-development"
      }
    },
    "layer": {
      "edits": [],
      "type": "shipped:software-development/task"
    },
    "roles": {
      "holder": "holder",
      "status": {
        "claimed": "in_work",
        "closed": "closed",
        "done": "done",
        "field": "status",
        "initial": "open"
      },
      "work": true
    },
    "sections": [
      {
        "key": "task",
        "text": "A #task is a piece of work: it states what to do and why. It stands under what it changes — a module, a capability, or the part when it spans the part — or under the spec it implements. Link the spec it implements or the block it was discovered from. The holder claims it before working, releases it if stopping unfinished, and finishes it with the commit that carries the work. What a child thread still holds when it stops working passes to the thread that gave it the work, which ends, releases or hands on each; taking a task from another holder is a claim. A waiting task points to its blocker with waits-on; larger work may have child tasks."
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
A #task is a piece of work: it states what to do and why. It stands under what it changes — a module, a capability, or the part when it spans the part — or under the spec it implements. Link the spec it implements or the block it was discovered from. The holder claims it before working, releases it if stopping unfinished, and finishes it with the commit that carries the work. What a child thread still holds when it stops working passes to the thread that gave it the work, which ends, releases or hands on each; taking a task from another holder is a claim. A waiting task points to its blocker with waits-on; larger work may have child tasks.