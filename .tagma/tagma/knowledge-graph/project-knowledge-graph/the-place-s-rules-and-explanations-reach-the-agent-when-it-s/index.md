---
id: 01a1175a-4c4e-7702-badc-614a00c25ecb
title: "The place's rules and explanations reach the agent when it sees code with any tool: the tool answer itself names the files it showed"
ord: 8
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/contract/service/table.ts
  - kind: file
    ref: apps/tagma/server/src/graph/orientation/touches.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/capabilities/touchRule.ts
  - kind: file
    ref: packages/agent/src/agent/tool.ts
---
The agent gets the place's rules and explanations not only when it reads a file with the `read` tool, but when it sees its code through the command line or search. Tagma never guesses the command and forbids nothing: the tool itself names the files it showed the model, and the rule delivery takes that list.

## What the user gets

- An agent reading code through `sed`, `cat`, `head`, `nl`, `rg`, `grep`, `git diff`, or `git show` gets that place's rules and explanations the same way as on `read`. Decisions recorded in the graph reach the agent before it proposes to break them.
- A search over a hundred files never buries the agent in texts: explanations of files seen only in search results arrive as a one-line pointer, and whole — when the file is read.
- The same for Claude through the terminal, Codex, and other CLIs that work with their own tools and report calls to Tagma through hooks.
- Never covered and never will be: reads inside scripts (`python3`, `node`, `perl`) and paths built in variables. That is a deliberate boundary.

## What stands now (read in code, 2026-10-07)

- Delivery on our own agents is `touchRule` (`native-harness/capabilities/touchRule.ts`): the `TOUCHING_TOOLS` list names `read`, `edit`, `write` and takes `input.path`. Any other tool stays silent.
- On ACP agents (Claude over ACP) the tools are Tagma's tools, and the same `touchRule` delivers (visible in threads: `runtime-guidance` with `hook: afterTool`).
- On CLIs through the terminal — `harnessFiles` (`external-harnesses/contract/service/table.ts`) and adapters: `claudeFiles` takes only `tool_input.file_path`, `codexFiles` also parses the patch. Those CLIs' Bash and Grep stay silent.
- The delivery owner is `Touches.touch` (`graph/orientation/touches.ts`): one path per call; `ThreadExecution.touched` (`invocation/nativeDoor.ts`) records the session task's touch and asks for the delivery.
- Measured over the last 300 runlith threads (one sample, on rollout records): `read` ≈ 12,000 calls; through the shell — `grep` 2,434, `sed` 2,306, `rg` 2,003, `cat` 994, `head` 80, plus `git show`/`git diff` in part of 1,655 `git` calls. About a third of code reads pass the delivery by.

## The decision

### The notion: what the answer showed

A tool answer carries the list of what it showed the model: the path and how.

- `read` — the model saw the file's contents or its part;
- `wrote` — the tool or command wrote the file;
- `found` — the model saw the file's lines among search results.

File names with no contents (`glob`, `ls`, `find` output) are not a show.

The tool declares the list, because only it knows what it printed. The consumer never enumerates tools by name: `TOUCHING_TOOLS` goes away. That way a new tool showing code joins the delivery with no consumer edit.

### Layers and data

1. **The `@runlith/agent` core** (`agent/tool.ts`): `ToolAnswerOptions` gets `shown` — a list of `{ path, as: 'read' | 'wrote' | 'found' }`, the path absolute as the tool resolved it. `AgentToolDoor` passes `shown` into the `afterTool` fact (`AgentToolCall.shown`). The core never interprets the value.
2. **`@runlith/agent-tools` tools** fill `shown`:
   - `read` — its file, `read`; a directory — nothing;
   - `edit`, `write`, `delete`, `rename` — their paths, `wrote`;
   - `grep` — the rows' files of its page, `found`;
   - `bash` — the `shellShown` result (below) plus paths the command wrote and attributed to this session by the change accounting (`moved` in the command outcome), as `wrote`.
3. **`shellShown`** — one function in `@runlith/agent-tools` (a new file next to `shellCommands.ts`), pure: the command, its output, the working directory, and a "this is a file" predicate. Two traces:
   - an argument of a plain command that, once resolved from the working directory (counting leading `cd x &&`/`cd x;`), is an existing file → `read`; flags, globs, and directories drop on the file check, not on a command list;
   - a path in the output in the forms `path:line:` (rg, grep -n), `path-line-` (rg/grep context), and `diff --git a/path b/path` → `found`.
   Word parsing is the existing `shellCommands`; no second parser appears. Cost is linear in the command and the printed output the tool envelope already bounds.
4. **The `native-harness` module**: `touchRule` takes `ctx.tool.shown`; `input.path` parsing and `TOUCHING_TOOLS` leave. One `ThreadExecution.touched` call per whole list.
5. **The `graph` module, the delivery owner**: `Touches.touch` answers a place list in one pass — `rulesAtPlaces` already takes an array of places, explanations read in one query over all places. `Touches.record` (the session task's touch, "another session reads this file") writes only for `read` and `wrote`: seen-in-search is no work on the file.
6. **`touchText`**: for `read`/`wrote` — as today. For `found`:
   - a rule — whole, header and body: per the [[19851665|law-by-reach decision]] (item 6) a rule without a body can never be executed; once per thread, by the same registry;
   - an explanation (`#note`) — as a pointer line "explained here — name and title", with no body and no "delivered" mark: per `#note` the explanation delivers when the code is read or written, and the body arrives on file read.
7. **The `external-harnesses` module**: the adapter declares `printedOf` — the command and what its CLI's search-by-content call printed (each CLI's event fields are its own, read by its adapter); `filesOf` stays the synchronous named-file parse. `dispatch.ts` runs the printed text through the same `shellShown` with an on-disk file check and asks for the delivery with one `touch_path` request per event. The `@runlith/agent-tools` card opens `shellShown.ts` as an entry for `external-harnesses`.
8. **The `touch_path` operation** takes a `shown` list and answers with briefs; `Touches.touch` itself resolves places, records the task touch, and builds the delivery, so the native door and the operation never each build it.

### Why this way and not otherwise

- Parsing the command line at the consumer (in `touchRule` or in adapters one by one) would give two copies of one output and knowledge of tools to one that never owns them.
- A "read commands" list (`sed`, `cat`…) goes stale with the first new command; an "argument is an existing file" check never depends on the command.
- Tracking process-open files (dtrace, fanotify) is a platform variant, heavy and unavailable on macOS without disabling SIP; two traces cover the measured majority.

## Parts

1. Core and tools: `shown` in `ToolAnswer` and `afterTool`; `read`, `edit`, `write`, `delete`, `rename`, `grep` fill it; `shellShown` and `bash`.
2. Delivery: `Touches.touch` over a place list, `record` only for `read`/`wrote`, `touchText` with the `found` form, `touchRule` with no tool list.
3. CLIs through the terminal: adapters declaring files (Claude, Codex, Devin, Cursor, Grok) through `printedOf` and `shellShown`; the batched request in `dispatch.ts`; an entry on the `@runlith/agent-tools` card.

Parts 1 and 2 land together: without the second nobody reads `shown`, without the first `touchRule` loses `read`.

## What shows it works

The implementer proves with tests through public operations:
- `shellShown`: `sed -n 1,5p a.ts`, `cat a.ts`, `cd sub && head b.ts` → `read` of the needed file; `rg x src` with `src/c.ts:3:…` output → `found` of `src/c.ts`; a nonexistent path, a directory, and a flag — nothing; `git diff` → its files as `found`;
- a thread that read a file through `bash` gets the place's rules and explanations once; a repeated read — nothing;
- a search hitting a file brings its whole rules and an explanation pointer; a later `read` of the same file brings the explanation body;
- search never records a task touch; `read` through `bash` does;
- a Claude PostToolUse Bash event through the terminal brings the same delivery.

The operator checks: the same history-measurement over threads after release — the share of code reads a delivery followed. That is no task-completion condition.
