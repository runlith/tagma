---
id: 01a16160-5ca8-73b3-a9de-21bb7202809c
title: HEAD movement triggers re-measure of affected rules and preserves escape provenance
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
---
Hook any HEAD movement of a checkout into the existing rule re-measure owner without timer polling. Select rules and paths by the diff against the last confirmed measurement; escapes keep the commit where the violation appeared and only the proven holder. The minimal public test first reproduces the hookless-commit miss; the rules skill describes the same contract. law-lab stays read-only.
