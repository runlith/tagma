---
id: 01a14c13-c481-7acc-8aa6-03b791c10f9c
title: The operator restores lines a thread wrote in removed turns without touching others' bytes
ord: 5
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-92846c655f6f
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03b329e7e083
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/RewindConfirm.svelte
  - kind: file
    ref: apps/tagma/server/src/change-record/operations/revert.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/runFiles.ts
---
**Value.** A failed agent turn is removed together with its file edits, without losing a single line another agent or the operator wrote into the same files.

**How.** A checkbox in the Rewind and Drop turn confirmation (turn rollback — A1); under it, the `revert_lines` operation.

**Behaviour.**
- A line returns to the mark it carried before the removed turns only if its write chain is proven and the on-disk window is unambiguous.
- Already committed lines, lines another session rewrote later, and unverified ones stay and are named in the answer; a file that moved during the rollback isn't touched.
- The reverse edit is recorded on the same thread as its write; the git index doesn't change.

**Limits.** A deleted file isn't recreated. The `revert_lines` operation itself is open only to the operator's live channel, and no screen calls it directly: the road to it is the rollback checkbox.
