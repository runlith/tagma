---
id: 01a14c14-a11c-7ce8-9d84-632c6aeb5d45
title: Project rules and dictionary stand in every thread's start, and their edits arrive mid-thread as a diff
ord: 3
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-928c2ce92792
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-694624989efa
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-694ce885261c
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-632d82cf4c27
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-632e5592ee8d
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-632f2c5e9bd2
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/instructions.ts
  - kind: file
    ref: apps/tagma/server/src/graph/orientation/Instructions.ts
  - kind: file
    ref: apps/tagma/server/src/graph/orientation/reach.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/turns/instructionRule.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/contract/wire/operations/outline.ts
    symbol: OUTLINE_OPERATIONS
---
**Value.** The agent starts work already knowing the project's law and dictionary, and sees a rule's edit on the next step — with no thread restart and no whole-law resend.

**How.** By itself: a native thread gets the set before every model step, a foreign CLI through hooks. Where a rule arrives is decided by its `delivery` field (`set_rule_delivery`): `prompt` into the start, `code` on touching code named by its sources; with no value a rule with sources goes as `code`, one without as `prompt`.

**Behaviour.**
- The set is the global graph's prompt rules, then the project's prompt rules as whole bodies, catalog guides, and tag prompts; an agent without the graph capability gets only rules. In a member of a group the project's rules give way to the group's rules and then every member's prompt rules, each under its project's name.
- Changes arrive as a diff: replaced records, new and withdrawn ones; with an unchanged set nothing arrives.
- Each change in the diff names who made it — `operator`, the thread that acted, or `you` — read from the journal of the block it came from, so an agent never has to ask the operator whether a change was his. A change no block's journal explains — a setting, a group's reach, a rename, a Tagma release — arrives without a name.
- Between checkouts of one project the delivered text compares: the same set never arrives twice, a differing one arrives as a diff. After context compaction the set arrives whole again.
- Nesting rules never overrides: a rule under a rule only shows indented.
- The answer to a delivery change names the new startup cost. Switching to `code` with no sources succeeds but warns: the text will reach no agent, while checking keeps judging the whole project. The exit is adding sources or picking `prompt`.

**Limits.** A disabled, replaced, or deleted rule is never delivered. Delivery cannot be set on a rule whose tag never declared it.
