---
id: 01a108e9-6003-7ee7-aec9-b4ca75d8d1d1
title: "Cursor ACP: cancel answered in 3–11 ms, a second prompt cuts off the first, a repeated permission answer to a closed id is ignored"
ord: 5
tags: ["research"]
fields:
  {
    "source": {
      "name": "cursor-agent 2026.09.15-d2fe57e, ACP v1, Free/Auto; real shells with a start marker; live probe 2026-10-04",
      "ref": "~/.tagma/scratch/01a10407-8719-764b-9fac-8b1d83b24de9/probes/cursor/ — client.mjs, cancel.jsonl, cancel-run.jsonl, midprompt.jsonl, tools-agent.jsonl, restoration-first.json, restoration.json"
    }
  }
edges:
  - kind: discovered-from
    to: 01a108ce-ee39-7d2f-9573-86fc0db65596
  - kind: relates
    to: 01a1050f-fe45-7d5b-a4d9-cb5c3632e800
  - kind: relates
    to: 01a10838-8f2b-7e30-a2b0-7563adb9cd5b
---
Measured 2026-10-04 on `cursor-agent 2026.09.15-d2fe57e`, ACP v1, Auto, Free. Frames with wall-clock and elapsedMs: `cancel.jsonl`, `cancel-run.jsonl`, `midprompt.jsonl`, `tools-agent.jsonl`. The standard `session/cancel` notification was sent with no JSON-RPC id.

## Cancel answers fast, no tool finish arrives

In the first probe cancel was sent a second after the tool_call execute, still before shell resolution. The answer to the source prompt — `{stopReason:"cancelled"}` — arrived in 11 ms. In the second, the shell truly started: the command first created `cancel-started.txt`, then had to sleep 30 and create `cancel-proof.txt`; the client saw the start file before cancel. The cancelled prompt answer arrived in 3 ms. After both cancels the process successfully answered session/list.

The started cancelled command created no final proof file: the start file stayed, cancel-proof was absent in the check over a minute later. In both probes no closing tool_call_update arrived for the standing in_progress call after cancel. These are two local time samples, not an upper bound for arbitrary hung tools. For the profile, cancel may wait within a bounded stop grace, but these samples do not establish its safe upper bound; past the grace the process must be ended by the execution owner. The projection must close unfinished calls on the prompt's cancelled answer.

## Second prompt cuts off the first

`midprompt` launched a shell `printf started > mid-started.txt; sleep 5; printf first-command-finished > mid-proof.txt`. Only after the start file appeared did the client send the second session/prompt. The first prompt got cancelled 3 ms after the second was sent. The second got end_turn and the SECOND message; FIRST never arrived. The final mid-proof.txt was absent after enough time, the start file stayed.

This is a new turn instead of the current one, not a queue and not steering. initialize declared no promptQueueing or steering extension. For the profile the safe choice is after-turn: messages during a turn wait for its answer, otherwise ordinary input becomes an interrupt.

## A repeated permission answer is ignored

After tools-agent finished, exactly the same JSON-RPC result was sent again to the already closed agent permission id 0 (`allow-once`). No new answer or error arrived for it; the next session/list returned successfully and the process stayed alive. This measurement justifies repeating a kept permission-result on an unknown record receipt within the same process and request id. It establishes nothing about another id, a repeated agent request, or a new process.
