---
id: 01a16b62-65bd-7e64-b65a-b72f418bc57e
title: "Restart the agent in one act: stop the turn, a new agent process from the installed build, and resume"
ord: 120
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a16b30-366a-7e95-8882-3a75165a13bd
  - kind: relates
    to: 01a16b5d-7897-74bd-9568-ce098da1f8be
  - kind: relates
    to: 01a16b5d-797d-753b-b118-85356a4f0313
---
## Why

A thread on an external agent (Claude Code, Cursor, OpenCode, Devin over ACP or SDK) holds an agent process. When that process or its link to Tagma breaks in a way Tagma never provided for, the thread stalls. That happened on 2026-10-23: a call stuck in `queued`/`gated` forever ([[165a13bd]]), an old-build runner outliving an update ([[8da1f8be]]), resume after process death failing with 400 ([[6a4f0313]]). The user can neither tell what broke nor get the agent working again: an unadmitted call has no buttons, stop-with-new-message goes through the same process, and only `kill` in the terminal replaces the process. One act is needed that gets the agent working again under any such breakage, including ones not yet known.

## What the user sees

A “Restart agent” thread menu item (in the same menu as Rename and Fork) and the same command to agents. One press, no confirmation, does everything at once:

1. If a turn runs, it stops it with an ordinary stop. A call that never started closes as unstarted, a started one — with unknown outcome, as on server restart.
2. If the thread's transport has an agent process, it ends it and raises a new one from the installed build. The new process continues the same vendor session, or — if it cannot be loaded — opens a new one from the Tagma journal (both roads exist).
3. If a turn ran, it opens a new turn as a journal resume. If no turn ran, it only swaps the process: the next words go to the new one. A transport that declared it cannot resume without new words (`continue: false`: Devin, terminal CLIs) gets stop and process replacement with no resume. Waiting words open a turn on the new process, otherwise the thread waits for the next words. Tagma writes no words as the operator.

The feed keeps one restart record: who did it, which turn stopped, whether it resumed (if not — the record says outright the turn will resume from the next message) and which calls closed. Every thread has the item, native ones too: a native thread has no process, and restart reduces to stop and resume. So the interface never gives away the transport ([[e5eed6b8]] rule), and on a native thread the button also clears a stuck turn.

## Mechanism

- The act belongs to the thread kernel: one operation next to `stop_run` and `continue_thread`, with the same rights over another's thread as stop. It calls `ThreadStopping.stop` in sequence and waits for the turn to end, then the thread transport's `TransportResource.release`, then the kernel resume (`continue`); the act's mechanism is [[0a2d7254]]. The kernel never branches by vendor ([[6f758080]] rule): the transport swaps the process via its own `release`, and a transport without `resource` simply skips it.
- Raising the new process is the driver's existing road at the next turn launch. Verify that after `release`, the next `launch` raises a process from the current build instead of waiting for the old one — for ACP (`attendance.stop`) and the terminal CLI (`sessions.stop`).
- Process replacement on a Tagma update ([[8da1f8be]]) is already done by idle release after an hour of idleness (`ProtocolProcess.release`, [[8711a398]]): waiting words go to the new process instead of falling through, as with `attendance.stop`. There is no second replacement implementation ([[dd380bf6]] rule).
- Wordless resume for Claude Code is fixed in [[6a4f0313]]; for the other adapters verify such a resume yields a request the vendor accepts.

## Done when

- A Claude Code thread stuck on a call that will never be admitted, after one act, ends the turn as `aborted`, closes the call, works on a new process (a new execution at the execution host) and resumes the turn. Proof is an end-to-end test through the protocol rig with a scripted Claude Code (`claudeConformance`), where the call is held and never admitted; without the operation the test stalls.
- A turnless thread after the act stands with no old process and opens no turn; the next words raise a process from the installed build.
- A native thread after the act ends the turn and resumes it.
- The same end-to-end test passes for every ACP adapter the rig can raise.
