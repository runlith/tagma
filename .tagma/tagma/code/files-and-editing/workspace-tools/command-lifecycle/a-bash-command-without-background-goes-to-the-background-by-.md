---
id: 01a11d9a-c0fd-7b8f-9275-93f8d6325dc6
title: A bash command without background goes to the background by itself past a threshold instead of holding the turn until the command limit
ord: 3
tags: ["idea"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: file
    ref: packages/agent-tools/src/commandWork.ts
---
Today a `bash` command without `background: true` holds the call until its limit (command rule, usually 5 min) and then breaks off. An agent that misguessed the duration loses both time and result.

How others do it (probes of 2026-10-08, [[44dbe4a8]], [[04ba7dd7]], [[14005f86]]):
- Claude Code: `Bash` without `timeout` moves the command to the background after 120 s, the call answers, the command can be read to the end;
- Devin: `exec` goes to the background after ~10 s, output is awaited by a separate `get_output` (limit 280 s);
- Codex, Cursor, Grok: ≥ 200 s in the foreground, never reached the limit.

Possibility: past the threshold, a foreground call answers with what has been printed plus the command id, and the process continues as a background one — read with `read_command`/`read_output`, its end arriving as a notification. Breaking off on the limit stays only for an explicit `timeout`.

To decide: the threshold size and whether it derives from the machine (rule fe83acfa); how this combines with command rules, which now limit both foreground and background; whether this breaks agents waiting for the exit code in the same call.
