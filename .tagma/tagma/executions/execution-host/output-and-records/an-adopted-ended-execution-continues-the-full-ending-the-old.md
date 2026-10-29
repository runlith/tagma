---
id: 01a17e3d-1aee-730f-a09b-7cead5c57ac2
title: An adopted ended execution continues the full ending the old logic recorded instead of measuring it again
ord: 14
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a17e2e-8a2d-762d-a173-7332d45fdc72
sources:
  - kind: file
    ref: packages/execution-host/src/registry/adoption.ts
---
A holder that handed the new logic a child whose leader it already reaped answers `unmeasured` about its process group: a reaped leader's group can no longer be measured, its number may already belong to someone else's processes. Measuring such an execution again would therefore yield `cleanup: unverifiable` over the `complete` the old logic proved while the group was still measurable. Retire refuses `cleanup-unproven`, and `call`/`held` on pipes that ended before the logic swap could never be released: their record would lie until the generation changes. So adoption takes the recorded ending when the line has ended and its final facts say `complete`. A partial ending is measured again: a new measurement may yet prove more. Adopted `call`, `held` and pty commands stay held until the caller retires, as in one logic. They do not count in the shelf share: their record is what the caller is still reading, a terminal screen for example.
