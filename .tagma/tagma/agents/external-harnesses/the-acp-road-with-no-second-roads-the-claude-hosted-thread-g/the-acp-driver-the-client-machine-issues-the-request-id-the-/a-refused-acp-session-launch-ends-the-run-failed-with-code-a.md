---
id: 01a13608-3deb-7e66-a559-5639586f0a68
title: A refused ACP session launch ends the run failed with code and unblock instead of looping uncertain
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13605-305b-7131-8d13-9f627d06eb07",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/attendance.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/launcher.ts
---
An ACP session launch failure before process start slides into `uncertain` (`ProtocolAttendance.attend`, `catchCause`), and `ensuring(observe)` raises `attend` again: a loop with no end, the kernel run stands `running` with a fresh heartbeat, operator and parent see nothing. Example: thread 01a135fb, `unknown-account` from `HarnessAccounts.launch`, the only `claude-code` account `signed: false`.

Do:
- `ProtocolLauncher` classifies the launch failure by condition ([[ea465bed|failure rule]]): a typed refusal (`GateRefusal`: account, installation, model, place) ends the run via the kernel as `failed` with the `launch` cause, its own code, cause and `unblock` — via the one road `ProtocolEndings.finish`.
- A failure that will not pass by itself blocks the follow-up wake at once: no second useless launch and no second parent report; a new explicit word tries again.
- `uncertain` stays only where the process may have lived (`launch-uncertain`, a post-start failure).
- Check whether to refuse as early as `spawn_agent`/`set_agent_model`.

Done in 789a72240b. Unproven: the new `protocolRuns.stest.ts` system test (“a launch its account refuses…”) never passed or failed on the merits — the file does not load because of another's unfinished edit in `packages/executions` (`USAGE_READING_BYTES`), and before it all 7 of the file's tests fell at lead birth (`unknown-account … openai-oauth`, not from this work); the terminal-start refusal before dispatch and the stop race mid-prepare are test-uncovered; the account list hides an unreadable CLI entry until a `default` record exists; the birth refusal (`spawn_agent`/`set_agent_model`) never added: launch is the only place the entry is read, and the refusal reaches the parent within the same seconds.

Proof: a red contract test — an ACP run whose launch a typed refusal refused ends `failed` with a code, the parent gets one report; affected tests and `bun run typecheck`.
