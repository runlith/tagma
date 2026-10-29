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
          "code"
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
        "text": "When the operator corrects how agents work beyond this task — what they would want from any agent tomorrow — record it as a #rule in that turn and name it in the answer. Priorities, plans and orders for now are not rules; in doubt, offer one in a line. One norm per rule, split where obligations change independently, as short as the norm allows: it rides every thread it reaches. The title states the obligation; the body holds only what the title cannot work without — a condition, an exception or an example — in plain words for a reader with no context, and stays empty when the title is enough. No internal codes, section numbers, references to specs and tasks, history, measurements, trials, or what is removed or not in force: those go in the spec or note it relates to. Distinguish requirements from recommendations. A rule is an obligation, never a substitute for explaining a mechanism; code breaking it is a violation to fix or escalate, never an exception to record. `delivery: prompt` stands in every thread's startup instructions, for a norm across the project or wider than the code it was born in; `code` arrives when an agent reads or writes the code its sources name, for a norm about that code. Unset, a rule with sources is `code`, one without `prompt`; switching keeps the sources. A rule stands under what it governs: the module its sources name, or the root for law over the whole project; its place serves the reader, and its delivery and sources decide who receives it. Nesting overrides no ancestor. A global-graph rule has no sources and rides every project. A rule is active unless enabled is false. A measurable rule is enforced through enforce_rule alone: it writes the enforcement document — the key of its inspection in `tagma.config.ts`, strictness (note, watch or gate), triggering operations before or after, debt — makes every violation then standing debt, and is the only way strictness moves or debt grows — growing debt is a loosening done in the open; the re-measure driver only retires vanished debt and records or drops escapes. The rule measures the code its sources name, or the whole project without sources, whatever its delivery; only title and body reach a prompt. Each debt entry is a standing violation, never an exception, owned by the task or spec that removes it, retired once that violation is gone; at gate a violation outside the debt is refused, never recorded as allowed. Refused code belonging to another subject moves to its owner; code belonging where it stands, in a place shaped wrong, lands with its violation as debt owned by a new task naming the area and what was seen — the worker that met the gate neither redesigns the area nor declares the rule wrong: that view goes into the task. Whoever takes a debt task first finds how far its cause reaches, one file or a whole area; work over an area takes over the debt of every file it covers. A rule wrong for a class of code is changed for that class in its inspection in `tagma.config.ts`, on the operator's word. A rule switched off, replaced or trashed is no longer enforced."
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
When the operator corrects how agents work beyond this task — what they would want from any agent tomorrow — record it as a #rule in that turn and name it in the answer. Priorities, plans and orders for now are not rules; in doubt, offer one in a line. One norm per rule, split where obligations change independently, as short as the norm allows: it rides every thread it reaches. The title states the obligation; the body holds only what the title cannot work without — a condition, an exception or an example — in plain words for a reader with no context, and stays empty when the title is enough. No internal codes, section numbers, references to specs and tasks, history, measurements, trials, or what is removed or not in force: those go in the spec or note it relates to. Distinguish requirements from recommendations. A rule is an obligation, never a substitute for explaining a mechanism; code breaking it is a violation to fix or escalate, never an exception to record. `delivery: prompt` stands in every thread's startup instructions, for a norm across the project or wider than the code it was born in; `code` arrives when an agent reads or writes the code its sources name, for a norm about that code. Unset, a rule with sources is `code`, one without `prompt`; switching keeps the sources. A rule stands under what it governs: the module its sources name, or the root for law over the whole project; its place serves the reader, and its delivery and sources decide who receives it. Nesting overrides no ancestor. A global-graph rule has no sources and rides every project. A rule is active unless enabled is false. A measurable rule is enforced through enforce_rule alone: it writes the enforcement document — the key of its inspection in `tagma.config.ts`, strictness (note, watch or gate), triggering operations before or after, debt — makes every violation then standing debt, and is the only way strictness moves or debt grows — growing debt is a loosening done in the open; the re-measure driver only retires vanished debt and records or drops escapes. The rule measures the code its sources name, or the whole project without sources, whatever its delivery; only title and body reach a prompt. Each debt entry is a standing violation, never an exception, owned by the task or spec that removes it, retired once that violation is gone; at gate a violation outside the debt is refused, never recorded as allowed. Refused code belonging to another subject moves to its owner; code belonging where it stands, in a place shaped wrong, lands with its violation as debt owned by a new task naming the area and what was seen — the worker that met the gate neither redesigns the area nor declares the rule wrong: that view goes into the task. Whoever takes a debt task first finds how far its cause reaches, one file or a whole area; work over an area takes over the debt of every file it covers. A rule wrong for a class of code is changed for that class in its inspection in `tagma.config.ts`, on the operator's word. A rule switched off, replaced or trashed is no longer enforced.