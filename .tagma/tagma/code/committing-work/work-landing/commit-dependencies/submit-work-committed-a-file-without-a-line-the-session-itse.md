---
id: 01a173ce-e2ca-76bd-9d68-569034fc8341
title: submit_work committed a file without a line the session itself wrote, and the commit does not compile
ord: 6
tags: ["reflection"]
fields:
  {
    "actual": "Commit 5cffbef71e carries the body and the `freshly(threadId, …)` calls but not the `threadId: string,` signature line. The change record attributed it to nobody (“written outside the record”, read_changes at 15:21Z: nobody +1/−0). That commit went into build 39658b0475, and every terminal-thread launch crashed with ReferenceError.",
    "command": "submit_work (subject \"Judge a terminal vendor cut again…\", no paths) by session 01a17326-ef22-7865-b9a0-10ff558b36ba after this session's write of apps/tagma/server/src/external-harnesses/sessions/alignment.ts at 15:05:29Z (thread record #4834)",
    "expected": "The commit carries every line the session wrote with its own writes/edits; if a used name's declaration is missing from the commit, submit_work refuses and names the missing declaration."
  }
---
Proof:
- **Session write.** Thread record #4834 (write alignment.ts) contains the `    threadId: string,` line in `freshly`. Later edits #5227/#5229 did not touch that signature.
- **Commit.** `git show 5cffbef71e -- …/sessions/alignment.ts`: `const freshly = Effect.fnUntraced(function* (` has no `threadId`, while both calls pass it as the first argument.
- **Change record.** read_changes on that path right after the commit: `nobody +1/−0 (written outside the record)`.
- **Consequence.** serve.log 15:58:08Z and 15:58:32Z: `an external session became uncertain … ReferenceError: threadId is not defined at …/sessions/alignment.ts:178:54`. Repaired by hand in commit d9bcca3334.

The `    threadId: string,` line repeats many times in this file, including in methods the same commit deleted. That is an untested hypothesis about where the misattribution came from.
