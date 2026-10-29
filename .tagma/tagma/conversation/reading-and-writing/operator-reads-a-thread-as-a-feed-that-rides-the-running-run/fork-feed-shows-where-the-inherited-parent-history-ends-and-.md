---
id: 01a1500e-b305-7d6a-a3a1-0a95b8581fa9
title: Fork feed shows where the inherited parent history ends and its own begins
ord: 1
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a14bc0-754e-7774-9bf0-abe5760fe634
---
**Observation (2026-10-18).** A fork launched with copied history (`fork: all`) draws inherited entries as its own. Its feed opens with the parent's prompt, the parent's "agent-birth" message and the parent's work, followed by a second "agent-birth" — the assignment to the fork itself. The reader takes this for a duplicate or a bug: that is what happened with [[01a1500c-d3e0-7833-9074-701d5565c647|rename-fixtures]], a fork of the rename-claude-code flow. The journal tells these entries apart (`origin: inherited`), but the interface does not.

**What to think through.** How to show where the inherited history ends and the fork's own starts:
- collapse the inherited part into one line "History of [parent] before fork" with a link to the parent flow;
- or put a "Fork of …" divider before the first own entry and dim everything above it.

Separately decide whether to show the parent's first "agent-birth" at all when the fork received its own assignment.

**What would help decide.** How often the reader opens a fork for its own work versus for the parent's context. How many inherited steps forks tend to carry.
