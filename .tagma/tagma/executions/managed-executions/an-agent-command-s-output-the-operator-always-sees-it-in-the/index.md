---
id: 01a17e18-334d-79d8-9477-6b9e908f3f65
title: "An agent command's output: the operator always sees it in the terminal, the agent receives it as a file, and the space under it is bounded by a disk share"
ord: 49
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47bbffb12110
  - kind: relates
    to: 01a15c49-6c0d-7317-893d-d54d0c39e069
  - kind: relates
    to: 01a16bec-bf6a-75a2-be08-e40a4d94aa4b
---
## Why

An agent needs its command's output as a file: to run `rg` over it, re-read a chunk, compare two runs. Tagma already keeps every command's output in the execution host record, but not as a file — as segments behind `read_output`, `search_output` and `read_command_bytes`. The only path to a file today is redirecting output (`> log 2>&1`). Then not a byte reaches either the record or the operator's terminal, and a long command looks dead. `tee` keeps the terminal, but in `cmd | tee log` the exit code is `tee`'s, and a failed command looks successful. The root: Tagma holds the output but doesn't hand it to the agent in the shape the agent works in.

The outcome for all users. A newcomer does nothing and loses nothing. The operator watches the command's progress at any moment. The agent receives the file with no single step upfront and no prohibition.

Today a command row with no output shows nothing: the Output terminal only rises with the first byte ([[0c39e069]]). So a command that stays silent on its own or whose output was diverted is indistinguishable from a hung one.

## What will stand

1. **The output file.** When a pipes execution with at least one `output`-stream byte ends, the host places a plain `output.log` file in its record. In it the `output` bytes — stdout and stderr in the order the host read them — within the record window (the last 8 MiB). The file is written before the record goes to the shelf, so the shelf counts and evicts it together with the record. The sealed record's summary names the file's path and byte range (`from`, `through`); if the output's start left the window, `from` is above zero.
2. **Answers name the file.** The `bash` answer, the background-command end notification and the `read_output` answer on an ended command name the file in one line, unless they carry its full output themselves. The line holds the path and, if the start wasn't kept, how many bytes left. An answer carrying the full output adds no line. The path from an answer exists at answer time. Later the record's eviction may remove it, and reading then refuses as for a missing path.
3. **The agent contract.** The `bash` description says: the operator sees the command's output, and Tagma stores it itself. While the command runs, `read_output` and `search_output` read it; once ended — the file from the answer. Redirecting output to keep it is unneeded: it takes it away from the operator. A file is written only for the program's own artifact (a report, JSON) or for output needed whole beyond 8 MiB. The `read_output` description says an ended command names its file.
4. **Work is visible while output stays silent.** The feed command row and its Output terminal show the command is alive and what it does: how long it runs, which of its processes are alive and how much CPU they take. This is needed for programs silent on their own, and for a command whose output the agent diverted anyway. Data is the host's existing measurements (the command's usage and its processes); a new measurement is introduced only if they fall short. The look is agreed with the operator by mockup before the build.
5. **Space is bounded.** The host shelf counts toward its free-space share (1/20) every current-generation record, including records shelved by the previous logic before its replacement, and evicts them in the same order.

## Construction

- **The file's owner is the execution host** (`packages/execution-host`): it writes the record and evicts it. The server or thread holds no second copy of the output: one fact — one owner. The trimmed tool-answer store (`read_tool_output`) doesn't fit: the command's output would be a second copy there, and that store's space is bounded only by the thread's life.
- **The file is assembled once `output` ends** (before the Completed verdict and long before shelf sealing, which awaits readers leaving), from the kept `output` segments: a temp file, then rename. Mid-command the stream is never written twice. Cheaper on disk would be replacing the `output` segments themselves with the file, but then one stream's sake changes sealed-record reading and verification (segment checksums, recovery). The copy costs only history depth within the same share.
- **Path and range travel from host to server** in the sealed record's summary, over the executions protocol: a new protocol field, corpus and conformance — by the package's rules. The server hands them to the `CommandRun` port (`agent-tools`), which fills `makeShellCommands`; `ShellSettlement` carries them in `finishedAnswer`. The end notification (`threads/collaboration/commandEndings.ts`) and `read_output` (`executions/commands/output.ts`) read the same summary.
- **"The answer doesn't carry the full output"** is one of three: the `OutputTail` tail at stdout or stderr dropped bytes; the notification tail (40 lines, 4 KiB) is shorter than the output; the record window lost the start.
- **Out of scope:**
  - pty terminals — they have a screen and `read_terminal_*`;
  - a world with no execution host (the sandbox) — a command there lives only inside its call, and the operator has no Output terminal to dim;
  - external harnesses' own tools (Claude Code, Codex) — Tagma doesn't override them.

## Cost

One sample: the operator's dev server, 2026-10-27.

- **Records:** 103 thousand over 12 days (about 8 thousand a day), 10 GiB on disk. A 1% sample: average record 82 KiB, median 16 KiB, max 10.7 MiB. Today a record holds stdout, stderr and `output`; the file adds one more copy of the `output` window. So within the same share a record grows about one and a half times, and history runs about a third shorter. This is an estimate, not a measurement.
- **Shelf (by code reading, confirm with a test in the shelf task):** the host's new logic starts with an empty shelf and doesn't count records shelved by the previous logic of the same generation. Generation eviction never touches the current generation: `oldestGeneration` selects only `current = false`. So such records lie until the generation changes, not within the share. On this machine every record since the generation start (October 15) is in place, although 10 GiB exceeds the 9.3 GiB share.

## Acceptance criteria

1. A pipes execution that printed less than the window holds after its end an `output.log` byte-equal to the `output` stream. One that printed more than the window — a file equal to the kept bytes, and a summary with `from > 0`. Empty `output` — no file. Verification — through the executions client, the door the server uses.
2. `bash` with output longer than the answer names the file, and the file holds the full output in print order. `bash` with short output adds no file line. Verification — through the `bash` tool in a managed world.
3. A background command's end notification and `read_output` on an ended command name the file when they don't carry the full output themselves.
4. The `bash` and `read_output` descriptions carry the item 3 contract of "What will stand".
5. After a host logic replacement the previous logic's current-generation records fall within the shelf share and are evicted by it. The test fails before the fix.
6. The command row and Output terminal show time and live processes with CPU while output stays silent — per the agreed mockup.
7. Typecheck, affected-package tests, and the executions protocol corpus and conformance are green.

The operator owes only the decision on the row and terminal look by mockup, before the build. This is no acceptance condition.
