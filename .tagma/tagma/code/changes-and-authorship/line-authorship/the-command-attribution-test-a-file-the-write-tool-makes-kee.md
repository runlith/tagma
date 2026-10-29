---
id: 01a176e0-5b35-7fdb-96b3-2681f214639f
title: The command-attribution test `a file the write tool makes keeps its row…` fails under shared itest load and passes alone
ord: 79
tags: ["task"]
fields:
  {
    "holder": "tagma:01a176ec-e9b1-7523-ba90-f29ff30b281b",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a176b7-7ebf-7d63-ac5a-90cf76a1124d
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/change-record/commands.itest.ts
---
The `commands.itest.ts` test "a file the write tool makes keeps its row, and a script of the same step changing it after is unproven" failed twice under the shared itest load of landing and change-record (`testbed`, about 80 files, 10 processes) and passed separately every time (three full file runs, 9 of 9). The scenario is concurrent: the `write` tool creates a file, and a script in the same step waits for it through `fs.watch` and appends a line. Under load, either the tool write or the command window records in a different order. The failed run's output was never saved; the cause was never established.

The cause is established: the third assertion fails — exact equality of the unattributed list. The command snapshot manages to read the CAS staging `src/.new.ts.<uuid>.tagma`, and its later removal becomes an unowned edit. Reproduced 7 failures in 100 repeats under shared load; the shared run of 74 files on 10 processes with seed=3 gave 279/280. `files/replace` now declares its staging-name recognition, snapshots exclude such untracked files and keep tracked files and directories with similar names. The original concurrent test is unchanged. After the fix, the same shared seed=3 gives 280/280 and a rerun 100/100; a deterministic test with a real `replaced` and a FileSystem-port wait first failed without the fix, then passed.
