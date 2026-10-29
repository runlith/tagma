---
id: 01a12ce8-c230-7c84-b73e-af878166f224
title: "The imports gate does not judge moving code out of @runlith/llm: a manifest change in a widely imported package hits the 10000-file envelope"
ord: 48
tags: ["reflection"]
fields:
  {
    "actual": "083d37f1 failed: \"(envelope) modules is not judged: the subject is too large — it reaches 10001 files and 34.3 MiB, past its envelope of 10000 files and 80 MiB\"; submit_work refused inspection-failed, the pre-commit hook calls the same check, so a direct git commit hits it too. The envelope is the constant `envelope: { files: 10_000, mib: 80 }` in apps/tagma/inspection/src/packs/architecture/modules/declaration.ts:383; neither a rule parameter nor narrowing gets around it: any @runlith/llm manifest change pulls in all its consumers.",
    "command": "check_rules({rules:[\"083d37f1\"], whole:true}) over the change of task 51d6a7bf (moving vendor code from packages/llm to packages/adapter-*, editing packages/llm/package.json); same for narrow paths without one tsconfig.json",
    "expected": "The modules rule judges the change (or says how to narrow it so it can be judged), and submit_work can land the transfer that passed typecheck and tests"
  }
---
Filed from project `runlith`.

check_rules over:"all" on HEAD 78460c39 passes (≤10000); the change adds net +1 file (packages/builtin-catalog/package.json and tsconfig.json, minus the removed vendorTokens.ts) and crosses the limit by exactly one file. ea465bed, 50520d64, 6b3210c7 clean over the same change. Related: c94f3d86 (80 MiB limit on merge).
