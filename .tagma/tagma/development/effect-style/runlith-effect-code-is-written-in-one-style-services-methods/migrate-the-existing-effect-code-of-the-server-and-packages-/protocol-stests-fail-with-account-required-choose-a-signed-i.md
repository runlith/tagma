---
id: 01a13e13-328c-7bc0-82f2-a7b7b5a763d2
title: "protocol* stests fail with account-required \"Choose a signed-in directory account for claude-code\": find the commit and cause, fix at the root"
ord: 33
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13e13-5097-794a-92a6-1ce954804dc1",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13dcf-befa-7092-b69c-20473c961b0c
sources:
  - kind: file
    ref: apps/tagma/server/src/providers/accounts/harnessAccounts.ts
---
`account-required` already reproduced on d14f581102, the parent of b5ff50940b: not a new regression from the providers/credential-file migrations b5ff50940b, 97e91dff46 and 7d8e7d8686. Commit 401153e02f fixed the test stands: the runner stub is placed as `tagma` in its own PATH after the argv move in 69344afaae; the `devin` stub exists before CLI lookup and answers `--version` after the lookup change in 5c8d2aff79. The live Claude stand aligns the login check's HOME with the model process's. Claude-stub door stands use the fixture's directory account; the real model stays a separate live check. 7840e5210a brought the `protocolRuns` fix: the lead is born before signing out of the account, otherwise the test refuses when birthing a lead on the fallback openai-oauth without verifying the child-launch refusal.

An additional step-compaction defect was fixed in 15c6b20d58. A request could enable autoCompact before the turn opened, after which replacing the query for the prompt or toolAliases reset the flag. This combination appeared with step compaction added in bfd2324f62. Lifecycle now carries the state between query and reconciles the flag change with publishing a new channel. An independent Sol review found a neighbouring cancellation race on reopen: confirmed with a separate red test and fixed at the same owner, without turning cancellation into session death. Both regression tests go through the public ACP handlers; the full runner contract is 60/60, the narrow type check of four files and their imports is 225 files with no errors. The runner contract explanation updated.

The current overall system-test green is unproven: the last `protocolStep` stopped in a fixture hook with `Service not found: effect/FileSystem`; the producer host bundle simultaneously failed to build over syntax errors of the unfinished execution-host migration. Blockers handed to owners; the FileSystem binding is already added to composition/runtime.ts when assembling serving, host syntax WIP remains. No repeat live run happened; no fixture workarounds and no others' file fixes were added. Stops 4/4, Methods 17/17, Acts 5/5 and Words 6/6 previously passed on the fixed stands; that is historical evidence, not a check of the current tree. The current live Step/Claude/Fork/Threshold and Runs stay unverified until the shared build recovers.

All changes of this work were made with targeted file-tool edits; no scripted migration applied. Temporary probes removed, own worktrees deleted, no uncommitted lines of the runner remain.
