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
        "library": "software-development"
      }
    },
    "layer": {
      "edits": [],
      "type": "shipped:software-development/rule"
    },
    "roles": {
      "delivery": "delivery",
      "enforcement": "enforcement",
      "law": "enabled"
    },
    "sections": [
      {
        "key": "rule",
        "text": "A #rule is a standing obligation on agents' work in this project. One norm per rule, split where obligations change independently, as short as the norm allows: it rides every thread it reaches. The title states the obligation; the body holds only what the title cannot work without — a condition, an exception or an example — in plain words for a reader with no context, and stays empty when the title is enough. No internal codes, section numbers, references to specs and tasks, history, measurements, trials, or what is removed or not in force: those go in the spec or note it relates to. Distinguish requirements from recommendations. A rule is an obligation, never a substitute for explaining a mechanism; code breaking it is a violation to fix or escalate, never an exception to record. `delivery` decides who receives the text, and the narrowest reach that serves the norm is chosen. `code` arrives when an agent reads or writes the code its sources name: a norm about particular code is `code`, sourced to that code. `finding` reaches nobody in advance and stands in the results of the rule's check: for a norm whose every breach the check catches wherever it appears, sourced to the code the check must look at or to nothing for the whole project; its earliest result is the check's earliest run — at landing, or seconds after a write for a check that judges one file alone and runs after edit and write. A norm an agent must know before designing, or one its check catches only in part, stays `code` or `prompt` even with a check. A norm with no check that can be broken anywhere gets a check offered and, until then, `code` on the code it governs. `prompt` stands in every thread's startup instructions for as long as the rule lives: only for a norm every thread needs whatever it works on. Unset, a rule with sources is `code`, one without `prompt`; switching keeps the sources. Nesting overrides no ancestor. A global-graph rule has no sources and rides every project. A rule is active unless enabled is false. A measurable rule is enforced through enforce_rule alone: it writes the enforcement document — the key of its inspection in `tagma.config.ts`, strictness (note, watch or gate), triggering operations before or after, debt — makes every violation then standing debt, and is the only way strictness moves or debt grows — growing debt is a loosening done in the open; the re-measure driver only retires vanished debt and records or drops escapes. The rule's check looks at the code its sources name, or the whole project without sources, whatever its delivery; only title and body reach a prompt or a check's results. Each debt entry is a standing violation, never an exception, owned by the task or spec that removes it, retired once that violation is gone; at gate a violation outside the debt is refused, never recorded as allowed. Refused code belonging to another subject moves to its owner; code belonging where it stands, in a place shaped wrong, lands with its violation as debt owned by a new task naming the area and what was seen — the worker that met the gate neither redesigns the area nor declares the rule wrong: that view goes into the task. Whoever takes a debt task first finds how far its cause reaches, one file or a whole area; work over an area takes over the debt of every file it covers. A rule wrong for a class of code is changed for that class in its inspection in `tagma.config.ts`, on the operator's word. A rule switched off, replaced or trashed is no longer enforced."
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
A #rule is a standing obligation on agents' work in this project. One norm per rule, split where obligations change independently, as short as the norm allows: it rides every thread it reaches. The title states the obligation; the body holds only what the title cannot work without — a condition, an exception or an example — in plain words for a reader with no context, and stays empty when the title is enough. No internal codes, section numbers, references to specs and tasks, history, measurements, trials, or what is removed or not in force: those go in the spec or note it relates to. Distinguish requirements from recommendations. A rule is an obligation, never a substitute for explaining a mechanism; code breaking it is a violation to fix or escalate, never an exception to record. `delivery` decides who receives the text, and the narrowest reach that serves the norm is chosen. `code` arrives when an agent reads or writes the code its sources name: a norm about particular code is `code`, sourced to that code. `finding` reaches nobody in advance and stands in the results of the rule's check: for a norm whose every breach the check catches wherever it appears, sourced to the code the check must look at or to nothing for the whole project; its earliest result is the check's earliest run — at landing, or seconds after a write for a check that judges one file alone and runs after edit and write. A norm an agent must know before designing, or one its check catches only in part, stays `code` or `prompt` even with a check. A norm with no check that can be broken anywhere gets a check offered and, until then, `code` on the code it governs. `prompt` stands in every thread's startup instructions for as long as the rule lives: only for a norm every thread needs whatever it works on. Unset, a rule with sources is `code`, one without `prompt`; switching keeps the sources. Nesting overrides no ancestor. A global-graph rule has no sources and rides every project. A rule is active unless enabled is false. A measurable rule is enforced through enforce_rule alone: it writes the enforcement document — the key of its inspection in `tagma.config.ts`, strictness (note, watch or gate), triggering operations before or after, debt — makes every violation then standing debt, and is the only way strictness moves or debt grows — growing debt is a loosening done in the open; the re-measure driver only retires vanished debt and records or drops escapes. The rule's check looks at the code its sources name, or the whole project without sources, whatever its delivery; only title and body reach a prompt or a check's results. Each debt entry is a standing violation, never an exception, owned by the task or spec that removes it, retired once that violation is gone; at gate a violation outside the debt is refused, never recorded as allowed. Refused code belonging to another subject moves to its owner; code belonging where it stands, in a place shaped wrong, lands with its violation as debt owned by a new task naming the area and what was seen — the worker that met the gate neither redesigns the area nor declares the rule wrong: that view goes into the task. Whoever takes a debt task first finds how far its cause reaches, one file or a whole area; work over an area takes over the debt of every file it covers. A rule wrong for a class of code is changed for that class in its inspection in `tagma.config.ts`, on the operator's word. A rule switched off, replaced or trashed is no longer enforced.