---
id: 01a12d48-5b23-72c2-81f7-de757cfb5f13
title: Move search keeps clean sources among candidates and honors start locations
ord: 24
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/inspection/src/core/node/judge.ts
  - kind: file
    ref: apps/tagma/inspection/src/core/node/reading.ts
  - kind: file
    ref: apps/tagma/inspection/src/core/rule.ts
---
The movement sample belongs to the builtin: modules counts coverage without reading an uncovered file, while platforms may judge start over app.files or programs outside the shared file sample. Clean sources stay among the eligible candidates: searching for a pair only among files with violations could let a new body adopt someone else's standing violation. For a fingerprint-based carry, location comes from the fingerprint, because the violation's place in the descendant and the carried start can be different files; the locations index holds the token boundaries that relocated uses.
