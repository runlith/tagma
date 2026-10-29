---
id: 01a15019-094c-7ef9-b8f4-53aac04c7b50
title: "A path renamed by case change alone is no longer judged ownerless: the working-file stat tells spellings apart on a case-insensitive FS"
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14a05-5a4d-76a0-b1af-97cb761579da",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/holdings/inputs.ts
  - kind: file
    ref: packages/files/src/working.ts
---
On macOS and Windows the filesystem is case-insensitive by default: after `theme.svelte.ts` → `Theme.svelte.ts`, lstat of the old path finds the new file. The Holdings judge (`change-record/holdings/inputs.ts`) reads the new bytes by the old path, disagrees with the deletion record, and shows the path as ownerless (`+22/−18 written outside the record`), even though one thread holds both the deletion and the write.

The fix at the producer: `exactWorkingAt` (`packages/files/src/working.ts`) over `workingAt` confirms the spelling of the path under the root: fast path — realpath matched the spelling segment by segment; otherwise (a symlink inside the path, a leaf symlink, a case change) each segment is looked up by exact name (NFC) in its own directory's listing. Holdings and move pairs (`record/moves.ts`) ask it; other `workingAt` callers are unchanged. Commits 553b780944, 4cf5b9a0b5 (after review: leaf symlink, symlink inside the path, directory case change in moves, unicode case).

Proof: the files-package itest (exact spelling — file, different case — absent, on any FS) and read_changes on `apps/tagma/app/src/lib/shared/theme.svelte.ts` after the operator restarted the server.
