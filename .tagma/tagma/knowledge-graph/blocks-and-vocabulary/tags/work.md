---
id: 01a1a3e7-088d-7f28-9f33-51a806129c15
title: work
ord: 17
tags: ["catalog"]
fields:
  {
    "id": "work",
    "release": {
      "guidance": "The work catalog carries work from possibility to result: an #idea keeps a possibility, a #spec agrees a change before it is built, #task blocks do the work, and #research keeps a reading from outside the project that the others rest on.",
      "profile": {
        "batch": [
          {
            "field": "source",
            "type": "shipped:work/research",
            "unblock": "set `source: { name: \"<what was read>\", ref: \"<url|version|checkout>\" }` — what the reading was taken from and where"
          }
        ]
      },
      "revision": "827a3434df19cda1d333515e8a7705af9abb8396953606f2f6c02ec146f9de63",
      "tags": [
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
          "prompt": "A #spec agrees a change the operator asks to have specified, before it is built. It thinks through what stands and what will stand: outcome, owners and boundaries touched, reason for the choice, checkable acceptance criteria. Split independent specs into children. Edit it in place when what is wanted changes: it always says what is wanted now. Closing its tasks does not close it: whoever ends its last task, or led its work, closes it once built, or once no longer wanted — the answer of finish_block, close_block or apply_batch that ends a task names the spec left with no open work, in this project or another. A closed spec is history, never current knowledge.",
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
              "text": "A #spec agrees a change the operator asks to have specified, before it is built. It thinks through what stands and what will stand: outcome, owners and boundaries touched, reason for the choice, checkable acceptance criteria. Split independent specs into children. Edit it in place when what is wanted changes: it always says what is wanted now. Closing its tasks does not close it: whoever ends its last task, or led its work, closes it once built, or once no longer wanted — the answer of finish_block, close_block or apply_batch that ends a task names the spec left with no open work, in this project or another. A closed spec is history, never current knowledge."
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
        },
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
          "prompt": "A #task is a piece of work: it states what to do and why. Link the spec it implements or the block it was discovered from. The holder claims it before working, releases it if stopping unfinished, and finishes it once the work happened. What a child thread still holds when it stops working passes to the thread that gave it the work, which ends, releases or hands on each; inside one thread tree a holder only notes who is on a task, and any member finishes or attributes it. A waiting task points to its blocker with waits-on; larger work may have child tasks.\n\nA task that changes code is finished with the commit that carries its work.",
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
        },
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
            }
          ],
          "id": "idea",
          "prompt": "An #idea keeps a worthwhile possibility not yet accepted: the question, the motivation, what would inform the choice, its uncertainty explicit. It obliges no implementation and may be closed once not useful; an accepted target is a #spec. A passing question need not become a node.",
          "roles": {
            "status": {
              "closed": "closed",
              "field": "status",
              "initial": "open"
            }
          },
          "sections": [
            {
              "key": "idea",
              "text": "An #idea keeps a worthwhile possibility not yet accepted: the question, the motivation, what would inform the choice, its uncertainty explicit. It obliges no implementation and may be closed once not useful; an accepted target is a #spec. A passing question need not become a node."
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
        },
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
          "prompt": "A #research node records a reading of something outside this project; `source` names what was read and where — its URL, version or copy. Separate observation from inference and say what the evidence does not establish; a measurement whose experiment was not kept says so: the record alone cannot reproduce it. Split a broad investigation by independent questions. A node resting on a reading relates to it and carries the versions and conditions it established, never a generalized result. Research says nothing about whether this project does what it studied.\n\nA reading of code names the checkout, commit or version read.",
          "roles": {},
          "sections": [
            {
              "key": "research",
              "text": "A #research node records a reading of something outside this project; `source` names what was read and where — its URL, version or copy. Separate observation from inference and say what the evidence does not establish; a measurement whose experiment was not kept says so: the record alone cannot reproduce it. Split a broad investigation by independent questions. A node resting on a reading relates to it and carries the versions and conditions it established, never a generalized result. Research says nothing about whether this project does what it studied."
            },
            {
              "key": "software-development",
              "text": "A reading of code names the checkout, commit or version read."
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
      ]
    },
    "tags": [
      "0d47cb37",
      "1f6ed1c7",
      "47e571a9",
      "12bde0d1"
    ]
  }
---
The work catalog carries work from possibility to result: an #idea keeps a possibility, a #spec agrees a change before it is built, #task blocks do the work, and #research keeps a reading from outside the project that the others rest on.