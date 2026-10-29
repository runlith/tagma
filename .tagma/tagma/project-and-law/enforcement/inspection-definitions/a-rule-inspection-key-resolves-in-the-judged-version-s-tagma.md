---
id: 01a1577c-054b-7070-82bd-cd5eebbfb806
title: A rule inspection key resolves in the judged version's `tagma.config.ts`, and enforce_rule accepts only a HEAD key
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/judging/descriptionChanges.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/rules/descriptions.ts
  - kind: symbol
    ref: apps/tagma/server/src/enforcement/remeasure/rule.ts
    symbol: chosenRules
  - kind: symbol
    ref: apps/tagma/server/src/enforcement/rules/reach.ts
    symbol: enforcedRules
---
The graph holds only the key for a rule, and the description comes from the version under judgment: a landing reads the commit tree, check_rules over a change reads HEAD with session lines, enforce_rule, set_module and remeasure read HEAD. Base and commit tree are judged with one description, so tightening doesn't refuse a landing for violations that already stood.

enforce_rule refuses `inspection-unknown` when the key isn't in HEAD: the graph is shared, and a rule with a key from someone else's uncommitted edit would fail every landing whose tree lacks that key. A key can only be tried before landing through check_rules over a change.

A version with no key or with a config that doesn't evaluate doesn't refuse by itself: the rule becomes unmeasurable, at gate that's `inspection-failed` with key and rule, at watch a `watched` entry. Loosening the law stays the graph's business.

The description's canonical form enters the measurement declaration identity. When an enforced description changes, check_rules over a change measures the whole reach with the new description and marks debt via `owed`; submit_work reports findings outside debt in `rechecked`. The tightening itself doesn't refuse for standing code, but new crossings of changed code and a gated-inspection failure keep refusing. For a preliminary absorb the same measurement reads the session config and passes the independent-unit count down to their places' unfolding: switching a builtin to a program doesn't change the accepted debt volume. After landing, remeasure confirms standing findings and establishes escape origins: first appearing from a description belong to this commit, earlier ones keep theirs.
