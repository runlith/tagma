---
id: 01a14c14-6895-75c6-80f2-47c8fe4b72a5
title: A file the work left in the sandbox is carried into the checkout as an ordinary recorded edit against the expected base
ord: 8
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/sandbox/guests/imports.ts
  - kind: file
    ref: apps/tagma/server/src/sandbox/operations/import.ts
---
**Value.** The isolated work's result reaches the project one file at a time, with authorship and no risk of overwriting another's edit.

**How.** `import_output` of the checkout thread: the sandbox, the path in the guest, the path in the checkout, and the expected base.

**Behaviour.**
- The base is "missing" or the destination digest a previous answer returned. A changed destination refuses and names what stands there now; a path with another session's uncommitted work refuses and names it, even if that session ended.
- The bytes land through the same door as `write`, and the change record keeps the replaced and written text; nothing is committed.
- Before reading, the guest is sealed — stopped. A sandbox of a working thread refuses if that thread cannot be held still; while reading runs, the sandbox can neither be released nor bound.

**Limits.** One file per call. Only a thread calls, and only from its own owner and project's sandbox.
