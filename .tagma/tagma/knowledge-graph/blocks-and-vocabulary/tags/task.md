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
        "library": "work"
      }
    },
    "layer": {
      "edits": [],
      "type": "shipped:work/task"
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
        "text": "A #task is a piece of work: it states what to do and why. Link the spec it implements or the block it was discovered from. The holder claims it before working, releases it if stopping unfinished, and finishes it once the work happened. What a child thread still holds when it stops working passes to the thread that gave it the work, which ends, releases or hands on each; inside one thread tree a holder only notes who is on a task, and any member finishes or attributes it. A waiting task points to its blocker with waits-on; larger work may have child tasks."
      },
      {
        "key": "software-development",
        "text": "A task that changes code is finished with the commit that carries its work."
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
A #task is a piece of work: it states what to do and why. Link the spec it implements or the block it was discovered from. The holder claims it before working, releases it if stopping unfinished, and finishes it once the work happened. What a child thread still holds when it stops working passes to the thread that gave it the work, which ends, releases or hands on each; inside one thread tree a holder only notes who is on a task, and any member finishes or attributes it. A waiting task points to its blocker with waits-on; larger work may have child tasks.

A task that changes code is finished with the commit that carries its work.