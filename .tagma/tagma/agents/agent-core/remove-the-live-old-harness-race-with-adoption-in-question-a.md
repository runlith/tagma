---
id: 01a13d57-b5bc-706f-890c-4c35a0609fb5
title: Remove the live old harness race with adoption in question and spawned-run conformance tests
ord: 184
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1605a-ae18-7ace-b8b6-f474bfdcb0ad",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13d2f-397e-77cc-90c3-6f023cd163f7
sources:
  - kind: file
    ref: packages/agent/src/thread/conformance/questionInput.test.ts
---
Cause: the conformance test setup — `dyingToolTurn` saves the call, but the old scripted harness stays alive. Recovery with `takeoverAfterMs=0` may take its turn before the old writer ends; independent `ThreadRunSequences` then take one seq with different acts. A fresh heartbeat in the same millisecond still fails the strict `heartbeatAt < now`, so `recoverNow()` may answer 0. After the saved intent the test closes the old harness: the old writer ends, the turn gets a handover, then the same test checks the call's refusal and the model's continuation. The same setup is fixed in the spawned-run acceptance and completed/unknown effect recovery scenarios (`runLog/processes.ts`): previous harnesses close before recovery.

A red full run reproduced `ask_user`: `Expected status completed, received failed`, cause "this key already names another act, so a changed request needs a new key" (208 ms); the next `offer_ready_answers`: `Expected 1, received 0` (73 ms). Command: `9af6993d-b2af-4f85-bb93-ececcc5b4028:167`. The second outcome also caught in the spawned-run scenario before its fix: `processes.ts:116`, 54 ms, command `e3172daf-6b2a-8207-df06-e4efea4df06:167`.

Check: package `typecheck`; first fix — 300 repeats of each of three cases at `--parallel=2` (900/900); final fix — 200 repeats of each of five cases (1000/1000, 56.25 s), full package (1520/1520, 16.44 s) and the SQLite consumer `runLog.processes.itest.ts` (10/10, 2.98 s). After the first delivery a full run caught the remaining dies() caller in the settlement test: `processes.ts:79`, `Expected 1, received 0`, 121 ms; both bare settlement edges fixed by an extra commit. Independent review of the first fix found no defects. Thirty full runs in a row are not claimed: the named load repeats of specific cases stand instead; a separate `rewind.test.ts` timeout examined in [[f7d14611|a separate measurement]] with no code change. The shared dies() left as is: some callers still speak through the old harness and close it on a later edge.
