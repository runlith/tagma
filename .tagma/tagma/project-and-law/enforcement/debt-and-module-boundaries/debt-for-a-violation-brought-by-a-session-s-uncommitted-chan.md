---
id: 01a14a8f-9644-712e-bd63-bca8ffbb6942
title: Debt for a violation brought by a session's uncommitted change is held for that change until landing
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/rules/held.ts
---
enforce_rule looks for a fingerprint named in `absorb` and missing in HEAD in the calling session's change, with the same court as check_rules over change. A found one is written to debt with `held` — the base at which it stood only in the change, and the file. Without this the "debt for a new task" path would be closed: debt was measured by HEAD, and the gate wouldn't let a violation outside debt into HEAD.

Ordinary debt in a file already present in the judged tree's base doesn't apply: there only what stands in the base itself counts as standing. Held debt applies there too, otherwise it wouldn't let the file's first crossing of the limit through. So `held` reaches the court (`judgedDebt`) everywhere debt is handed to the inspection.

Remeasure and enforce_rule keep held debt missing in HEAD while HEAD descends from base, the file hasn't changed since base, and it exists in the working checkout. Deleting the file drops the debt even before the first landing: a path missing in base and HEAD doesn't confirm the uncommitted edit still stands. A partial remeasure includes held-debt paths; a warm start confirms they're still held before letting an inspection through on the old identity. A landing carrying the violation turns the record into ordinary debt; a landing changing the file without the violation drops it. The merge driver reconciles `held` three-way, as owner.
