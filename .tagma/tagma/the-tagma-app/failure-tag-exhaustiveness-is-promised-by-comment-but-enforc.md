---
id: 01a0cac3-ce6e-74c2-a642-567fcf0a18ee
title: "Failure-tag exhaustiveness is promised by comment but enforced nowhere: noImplicitReturns absent"
ord: 39
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/accounts/status.ts
---
The failure-tag mappings (`wordOf`/`toneOf`/`reasonOf`, `status.ts`) name all seven tags with no default arm, and the comment at `status.ts:100-101` promises an eighth tag fails the build. It does not: that promise needs `noImplicitReturns`, which appears in no tsconfig of the repo (`packages/tsconfig/*`, the app's, the generated one) — an eighth tag compiles silently and reads as another failure at runtime. Claim [[41d4ff42]] states the exhaustiveness without the mechanism; the mechanism is still wanted.

Either enable the flag where the app is checked (scoping the fallout it surfaces) or pin the seven-tag exhaustiveness in `status.test.ts`. Done when an eighth tag cannot land silently.