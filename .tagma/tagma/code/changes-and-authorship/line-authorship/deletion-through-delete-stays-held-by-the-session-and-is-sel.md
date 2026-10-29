---
id: 01a16bfa-0324-7076-8f75-f49f645868b9
title: Deletion through delete stays held by the session and is selected by paths under a stale fsmonitor
ord: 64
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16bf8-586f-760f-aaeb-407cfb7a6dc6",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16bf7-ee7b-7577-820a-939bcb938ed5
---
Both deletion losses are fixed at the producers. The source record [[01a16bce-ae11-75eb-ba9f-d0a567961250|lazy-runtime stream]], call #1393, refutes the missed-Intake hypothesis: both delete results had `record: recorded` and `pendingConfirmations: 0`. With a stale fsmonitor, the Holdings probe took a HEAD blob missing from disk for `git: null`; `Retirer.revertible` completed the correct deletion line as `reverted`. `lettersAt` now keeps `deleted` from the already-read HEAD and directory record. Explicit selection separately depended on a silent git status; `changedWithin` supplements it with `git ls-files --deleted -z` strictly in the named literal areas, without a full untracked walk.

Two scenarios through the real doors are proven red→green in `submitDeletion.stest.ts`: write → native submit_work → delete → native submit_work without paths; delete with no sink record → submit_work of an external session with paths. Both use a real Git with a deterministic stale-fsmonitor hook. Before the fix Holdings answered the first with `status: nothing`; before the selection fix the second with `status: nothing` and `unmatched`. After the fixes, commits delete only the selected files. An extra initial run with `core.fsmonitor=true` and a working daemon passed: merely enabling fsmonitor does not reproduce the event loss.

One-file-per-command checks with `--parallel=1`: submitDeletion — 2, holdings — 14, retirement — 8, explicitLanding — 1, requests — 1, sweep — 8; all passed. The server `bun run typecheck` passed. Early TS2322 errors in the neighboring composition/drives.ts and runtime.ts were fixed by their current author, after which the unfiltered rerun is green. The diff is read for stray changes and secrets. Package production code did not change; a temporary diagnostic rollback of the folding condition is restored byte for byte and is not part of the delivery.

One independent review [[01a16c02-a0a1-7c17-87c4-fd2ba4b03d96|delete-review]] on openai-oauth/gpt-6.1-sol xhigh — no findings. Proof limit: the hook reproduces the stale monitor's answer, not a live daemon event-delivery race. No performance measurements were taken; the running server was untouched. The explicit-selection explanation [[4c940a20|paths]] is updated, and the reason for keeping the deleted path [[591ba192|in Holdings]] is recorded. The landing met the [[6b3210c7|file size limit]]: all of inputs.ts is read, there is nothing out of scope — the probe and input preparation of one Holdings judgement use shared forms. Through the exit the rule provides, the existing allowance is raised from 663 to 673 lines; the why is kept. check_rules remeasured the rule over the change: no new violations, only the standing debt.
