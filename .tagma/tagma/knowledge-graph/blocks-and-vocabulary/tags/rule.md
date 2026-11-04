---
id: 01a0bf8d-de89-7ed3-8a3b-aeeeaa607f67
title: "#rule"
ord: 6
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
    "identity": {
      "shipped": {
        "export": "rule",
        "library": "core"
      }
    },
    "layer": {
      "edits": [],
      "type": "shipped:core/rule"
    },
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
---
A #rule is a standing obligation on agents' work in this project. One norm per rule, split where obligations change independently, as short as the norm allows: it rides every thread it reaches. The title states the obligation; the body holds only what the title cannot work without — a condition, an exception or an example — in plain words for a reader with no context, and stays empty when the title is enough. No internal codes, section numbers, references to other blocks, history, measurements, trials, or what is removed or not in force: those go in a block the rule relates to. Distinguish requirements from recommendations. A rule is an obligation, never a substitute for explaining a mechanism; work breaking it is a violation to fix or escalate, never an exception to record. `delivery` decides who receives the text, and the narrowest reach that serves the norm is chosen. `prompt` stands in every thread's startup instructions for as long as the rule lives: only for a norm every thread needs whatever it works on. `code` arrives when an agent reads or writes a file its sources name: a norm about particular files, sourced to them. `finding` reaches nobody in advance and stands in the results of the rule's check: only for a norm whose every breach that check catches; a norm an agent must know before acting stays `code` or `prompt` even with a check. Unset, a rule with sources is `code`, one without `prompt`; switching keeps the sources. Nesting overrides no ancestor. A global-graph rule has no sources and rides every project. A rule is active unless enabled is false; one switched off, replaced or trashed binds nobody. A measurable rule can be enforced by a check `tagma.config.ts` declares over the project's files, through enforce_rule alone; the `rules` skill carries checks, debt and enforcement.

Over code: a norm about particular code is `code`, sourced to that code. `finding` suits a norm whose every breach its check catches wherever it appears, sourced to the code the check must look at or to nothing for the whole project; its earliest result is the check's earliest run — at landing, or seconds after a write for a check that judges one file alone and runs after edit and write. A norm with no check that can be broken anywhere in the code gets a check offered and, until then, `code` on the code it governs.