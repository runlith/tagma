---
id: 01a15432-f8c9-7b5f-9de9-d3a0cdbbe012
title: Platforms carries the base verdict onto the tree when the walk reads every changed file the same way
ord: 34
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a15417-b33a-7058-b932-71f2b7502f04
sources:
  - kind: file
    ref: apps/tagma/inspection/src/packs/js/platforms/carry.ts
  - kind: file
    ref: apps/tagma/inspection/src/packs/js/platforms/plan.ts
---
The platforms verdict depends on file contents only through what the walk reads from them: import sites with the lines they stand on, the route option value on files the app calls option files, and `.json` — manifests and configs through which aliases resolve. Everything else depends on file composition. So carrying requires that no path appears or vanishes, no `.json` changes, and every changed file's sites and route options read the same. The read's origin is compared, including parse-error text: the walk puts it into the violation message.

Lines enter the comparison because a violation carries its import's line. An edit that shifts an import never carries the verdict, even with the same load graph: otherwise the carried violation would point at the old line. A file whose text was never read is never carried either. A change that is not carried is computed by the walk over memo: only starts whose closure reaches the changed files are walked again.

Sites compare with no key order: one side usually comes from the parse cache, where the write schema arranges keys its own way, and comparing JSON lines as-is would never carry.

No size refuses a read, so carrying owes the plan nothing: the slice envelope only packs independent package groups into one slice, and an indivisible group or the off-package files larger than it is a slice of its own. A refusal for size would leave the rule unjudged exactly when a package outgrows the envelope, and a gate that cannot run lets every change land unjudged.
