---
id: 01a0f5d2-6771-70d4-9572-46c14ec62f60
title: tagma
ord: 13
tags: ["catalog"]
fields:
  {
    "id": "core",
    "release": {
      "guidance": "The core library ships the system types every Tagma graph may carry and names no domain workflow: a project is software, a notebook or anything else by the catalogs installed beside it. Every block, an untagged note included, connects to any block of its project or another with relates, and to its origin with discovered-from. In every project, an untagged note may carry file, directory or symbol sources for ownership, navigation and search; sources move and transfer with the same operations as other blocks. To deliver a note to file readers and writers, use a type supporting core/explanation. Tagged nodes keep their declared source kinds.",
      "profile": {
        "defaults": [
          {
            "contract": "core/reflection",
            "type": "shipped:core/reflection"
          },
          {
            "contract": "core/selection",
            "type": "shipped:core/view"
          }
        ]
      },
      "revision": "27ca30395edbf88b988fc75884ea086b2ecc7a84e6ebaabf22a3e874da5d1094",
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
            "actual": {
              "name": "line",
              "type": "schema"
            },
            "command": {
              "name": "line",
              "type": "schema"
            },
            "expected": {
              "name": "line",
              "type": "schema"
            }
          },
          "gates": [
            {
              "field": "command",
              "gate": "required"
            },
            {
              "field": "expected",
              "gate": "required"
            },
            {
              "field": "actual",
              "gate": "required"
            }
          ],
          "id": "reflection",
          "prompt": "A #reflection records friction with Tagma itself: what was invoked, what should have happened, what actually happened — each concrete, useful evidence or nuance in the body. A measured cost is evidence, frustration alone is not. Read the refusal before blaming the instrument; product defects belong to the product's owner. It is an observation, not a promise to implement; separate finished work answers it. A repeated sighting keeps its own evidence, never rewriting the first report.",
          "roles": {
            "observation": true
          },
          "sections": [
            {
              "key": "reflection",
              "text": "A #reflection records friction with Tagma itself: what was invoked, what should have happened, what actually happened — each concrete, useful evidence or nuance in the body. A measured cost is evidence, frustration alone is not. Read the refusal before blaming the instrument; product defects belong to the product's owner. It is an observation, not a promise to implement; separate finished work answers it. A repeated sighting keeps its own evidence, never rewriting the first report."
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
            "relates"
          ],
          "fields": {
            "layout": {
              "name": "viewLayout",
              "type": "schema"
            },
            "query": {
              "name": "blockQuery",
              "type": "schema"
            }
          },
          "gates": [
            {
              "field": "query",
              "gate": "required"
            }
          ],
          "id": "view",
          "prompt": "A #view saves a selection worth a durable address for repeated use, not every search: say what it answers; opening it runs its query against its own scope — a live reading, not a list to maintain.",
          "roles": {
            "leaf": true
          },
          "sections": [
            {
              "key": "view",
              "text": "A #view saves a selection worth a durable address for repeated use, not every search: say what it answers; opening it runs its query against its own scope — a live reading, not a list to maintain."
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
      "cbac1e90",
      "0b43ddc1"
    ]
  }
---
The core library ships the system types every Tagma graph may carry and names no domain workflow: a project is software, a notebook or anything else by the catalogs installed beside it. Every block, an untagged note included, connects to any block of its project or another with relates, and to its origin with discovered-from. In every project, an untagged note may carry file, directory or symbol sources for ownership, navigation and search; sources move and transfer with the same operations as other blocks. To deliver a note to file readers and writers, use a type supporting core/explanation. Tagged nodes keep their declared source kinds.