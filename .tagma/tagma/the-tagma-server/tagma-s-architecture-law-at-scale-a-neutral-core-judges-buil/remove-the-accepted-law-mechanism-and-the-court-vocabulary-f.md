---
id: 01a0f8ad-4253-7eee-b607-7f0b32061a72
title: Remove the accepted-law mechanism and the court vocabulary from every screen
ord: 11
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: implements
    to: 01a0f476-04c3-7115-9d3e-ca089140c692
---
Operator's order 2026-10-01: delete the accepted-law mechanism whole (adoption store, marks, publication, migration, predecessor, adopt_law, permit enforcement/accepted-law, AdoptedLaw ports, rule-checker:// subject, law_accepted witness) so rules judge exactly by the rule document read through Orientation.rules at the call's place; and replace the word Law and court language on every operator-visible screen and operation text with plain rule words.

Scope: apps/tagma/server/src/enforcement, graph vocabulary activation, composition wiring, machine store migration, apps/tagma/app features/law and the block page. Acceptance: server tsc clean, enforcement itests green, an edit of a rule in the graph governs the very next commit, no Law/adopted/pending wording on any screen, one #decision under 9140c692 records what was removed.