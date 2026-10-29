---
id: 01a15046-0e44-7ad6-903c-0011579bf436
title: "Program check findings lose their grouped sites: ProgramFinding has no `sites`"
ord: 118
tags: ["reflection"]
fields:
  {
    "actual": "ProgramFinding (apps/tagma/inspection/src/core/program.ts) has no sites field and the server's program projection (enforcement/programs/group.ts) drops them, so a refusal names only the first line; the environment program spells the other lines into its message instead",
    "command": "checks/law/program.ts answering an `environment` reading whose violations carry `sites` from unitsOf, through enforce_law/check_law",
    "expected": "A runner program's finding carries the other sites of one fingerprint to the gate, as builtin RuleViolation already does"
  }
---
Filed from project `runlith`.

Found by the independent review of the `environment` program (task 1d73cd66, rule 999bf9fa). Every runner program with one fingerprint per file × name meets this.