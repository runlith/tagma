---
id: 01a15ec6-779b-7619-ae55-a53e0c002fab
title: "Step 6: own voices for terminal and command reads, then frequent operations by thread history"
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15eee-c98e-7627-b72a-8243eb38a22e",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15eb1-1b10-757c-ac79-89ebc8d8b62b
---
Spec point 10: `read_terminal_screen`, `read_terminal`, `read_command`, `wait_command`, `wait_terminal`, `read_terminal_bytes`, `read_command_bytes`; voices of eight `runtime: true` operations through the same helper as the runtime tool; the next batch by call count from thread history.

Done, part 1 (commit 83ca6b516d): own voices of seven terminal and command reads — a screen as a header with handles and one glued block, per-line compact style description under `cells`; byte windows as `windowText` text after the range; states and facts as lines; the lazy `saidLines` helper in `presentation.ts`. The host hands over the line continued by the next one without cutting its spaces.

Done, part 2 (commit 4f3d4ba1ea):
- eight `runtime: true` operations: one set of `collaborationVerbs.ts` helpers (`sentText`, `startedText`, `stoppedText`, `continuedText`, `approvalText`) and `listedOutput` in `agentRoster.ts` draw the text — called by both the runtime tool and the operation voice in threads; runtime tools declare `document: true` and with `json: true` hand over the operation document; `list_agents` and `answer_approval` values at runtime now match the operation document;
- the next batch of own voices: `read_machine_load`, `start_terminal` and `read_terminal_operation`, `stop_terminal` (a receipt text shared with `stop_command`, now with execution, operation id, steps, and price), `read_compaction_choices`.

Call frequencies (all threads' activity, as much of it as is kept, `kind = tool-call`, Tagma operations only; the voice before this work):

| operation | calls | voice before |
|---|---|---|
| read_block | 834 | module's |
| read_owners | 558 | module's |
| send_message | 528 | shared (runtime — JSON) |
| search_blocks | 450 | module's |
| create_block | 364 | module's |
| edit_block | 226 | module's |
| read_changes | 158 | module's |
| submit_work | 152 | own |
| read_output | 131 | own |
| spawn_agent | 123 | shared (runtime — JSON) |
| finish_block | 116 | module's |
| claim_block | 98 | module's |
| send_task | 84 | shared (runtime — JSON) |
| read_zone | 78 | module's |
| start_terminal | 57 | shared → own |
| read_thread | 53 | module's |
| read_compaction_choices | 52 | shared → own |
| stop_terminal | 46 | shared → own |
| anchor_block | 40 | module's |
| read_machine_load | 40 | shared → own |
| read_terminal_bytes | 38 | own (part 1) |
| check_rules | 35 | own |
| wait_command | 29 | own (part 1) |
| list_agents | 25 | shared → own |
| wait_terminal | 24 | own (part 1) |

One measurement, one sample on this machine, in characters, on real answers (own voice / shared voice / JSON):

| operation | own | shared | JSON |
|---|---|---|---|
| read_terminal_screen (a 55×60 terminal, `git status`) | 1591 | 4962 | 4334 |
| read_command (a finished bash command) | 1063 | 5324 | 4577 |
| read_machine_load (`limit: 10`) | 8952 | 20240 | 16890 |
| read_compaction_choices (`limit: 5`) | 1364 | 2886 | 2737 |
| start_terminal | 95 | 1213 | 1183 |
| stop_terminal | 140 | 1004 | 941 |
| send_message (one delivery) | 217 | 373 | 359 |
