---
id: 01a0f5d2-6771-70d4-9572-46c14ec62f60
title: tagma
ord: 13
tags: ["catalog"]
fields:
  {
    "id": "core",
    "release": {
      "guidance": "The core library ships what every Tagma graph may carry — #rule law and the system types — and names no domain workflow: a project is software, a notebook or anything else by the catalogs installed beside it. Every block, an untagged note included, connects to any block of its project or another with relates, and to its origin with discovered-from. In every project, an untagged note may carry file, directory or symbol sources for ownership, navigation and search; sources move and transfer with the same operations as other blocks. To deliver a note to file readers and writers, use a type supporting core/explanation. Tagged nodes keep their declared source kinds.",
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
      "revision": "f79a12d238076424dc67e73ed496b8a1e892504947d1af949b180d80b3740dd6",
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
            "delivery": {
              "type": "enum",
              "values": [
                "prompt",
                "code",
                "finding"
              ]
            },
            "enabled": "boolean",
            "enforcement": {
              "name": "lawEnforcement",
              "type": "schema"
            }
          },
          "gates": [],
          "id": "rule",
          "prompt": "A #rule is a standing obligation on agents' work in this project. One norm per rule, split where obligations change independently, as short as the norm allows: it rides every thread it reaches. The title states the obligation; the body holds only what the title cannot work without — a condition, an exception or an example — in plain words for a reader with no context, and stays empty when the title is enough. No internal codes, section numbers, references to other blocks, history, measurements, trials, or what is removed or not in force: those go in a block the rule relates to. Distinguish requirements from recommendations. A rule is an obligation, never a substitute for explaining a mechanism; work breaking it is a violation to fix or escalate, never an exception to record. `delivery` decides who receives the text, and the narrowest reach that serves the norm is chosen. `prompt` stands in every thread's startup instructions for as long as the rule lives: only for a norm every thread needs whatever it works on. `code` arrives when an agent reads or writes a file its sources name: a norm about particular files, sourced to them. `finding` reaches nobody in advance and stands in the results of the rule's check: only for a norm whose every breach that check catches; a norm an agent must know before acting stays `code` or `prompt` even with a check. Unset, a rule with sources is `code`, one without `prompt`; switching keeps the sources. Nesting overrides no ancestor. A global-graph rule has no sources and rides every project. A rule is active unless enabled is false; one switched off, replaced or trashed binds nobody. A measurable rule can be enforced by a check `tagma.config.ts` declares over the project's files, through enforce_rule alone; the `rules` skill carries checks, debt and enforcement.\n\nOver code: a norm about particular code is `code`, sourced to that code. `finding` suits a norm whose every breach its check catches wherever it appears, sourced to the code the check must look at or to nothing for the whole project; its earliest result is the check's earliest run — at landing, or seconds after a write for a check that judges one file alone and runs after edit and write. A norm with no check that can be broken anywhere in the code gets a check offered and, until then, `code` on the code it governs.",
          "roles": {
            "delivery": "delivery",
            "enforcement": "enforcement",
            "law": "enabled"
          },
          "sections": [
            {
              "key": "rule",
              "text": "A #rule is a standing obligation on agents' work in this project. One norm per rule, split where obligations change independently, as short as the norm allows: it rides every thread it reaches. The title states the obligation; the body holds only what the title cannot work without — a condition, an exception or an example — in plain words for a reader with no context, and stays empty when the title is enough. No internal codes, section numbers, references to other blocks, history, measurements, trials, or what is removed or not in force: those go in a block the rule relates to. Distinguish requirements from recommendations. A rule is an obligation, never a substitute for explaining a mechanism; work breaking it is a violation to fix or escalate, never an exception to record. `delivery` decides who receives the text, and the narrowest reach that serves the norm is chosen. `prompt` stands in every thread's startup instructions for as long as the rule lives: only for a norm every thread needs whatever it works on. `code` arrives when an agent reads or writes a file its sources name: a norm about particular files, sourced to them. `finding` reaches nobody in advance and stands in the results of the rule's check: only for a norm whose every breach that check catches; a norm an agent must know before acting stays `code` or `prompt` even with a check. Unset, a rule with sources is `code`, one without `prompt`; switching keeps the sources. Nesting overrides no ancestor. A global-graph rule has no sources and rides every project. A rule is active unless enabled is false; one switched off, replaced or trashed binds nobody. A measurable rule can be enforced by a check `tagma.config.ts` declares over the project's files, through enforce_rule alone; the `rules` skill carries checks, debt and enforcement."
            },
            {
              "key": "software-development",
              "text": "Over code: a norm about particular code is `code`, sourced to that code. `finding` suits a norm whose every breach its check catches wherever it appears, sourced to the code the check must look at or to nothing for the whole project; its earliest result is the check's earliest run — at landing, or seconds after a write for a check that judges one file alone and runs after edit and write. A norm with no check that can be broken anywhere in the code gets a check offered and, until then, `code` on the code it governs."
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
      ]
    },
    "tags": [
      "cbac1e90",
      "0b43ddc1",
      "aa607f67"
    ]
  }
---
The core library ships what every Tagma graph may carry — #rule law and the system types — and names no domain workflow: a project is software, a notebook or anything else by the catalogs installed beside it. Every block, an untagged note included, connects to any block of its project or another with relates, and to its origin with discovered-from. In every project, an untagged note may carry file, directory or symbol sources for ownership, navigation and search; sources move and transfer with the same operations as other blocks. To deliver a note to file readers and writers, use a type supporting core/explanation. Tagged nodes keep their declared source kinds.