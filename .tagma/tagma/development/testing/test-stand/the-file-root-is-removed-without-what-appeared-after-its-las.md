---
id: 01a16e32-4ad9-79d7-be23-00cd131e63f6
title: "The file root is removed without what appeared after its last test: under `--no-isolate` Bun imports the next file while TMPDIR still points at the previous root"
ord: 10
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/testbed/src/core/bed.ts
  - kind: file
    ref: packages/testbed/src/core/run.ts
---
The kit sees file switching only in the next file's first hook (`handoff`), while Bun by then has already executed its top level. A directory created there by `mkdtempSync(tmpdir())` lands in the previous file's root, and removing the root whole deleted it before `beforeAll` — so files holding a temporary directory in a module constant failed depending on which file ran before them.

So the root remembers its entries at each test's end. On removal it deletes only those; what appeared after the file's last test stays, and the root itself is removed at the next file's end. When nothing appeared after the last test, the root is removed at once, as before. What a worker leaves on exit is found by the next run's `sweep` by the root's dead owner.
