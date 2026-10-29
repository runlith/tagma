---
id: 01a0d137-171d-7d3b-af4a-c7d16c8029ae
title: "Stage 3c of program rules: enforce them — the wire copy and per-process endings, the default yielding, server resolution, and program rules writable"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d15b-4886-7393-b3e6-60b82a19d448",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0cfa1-81c1-714d-83d1-1b6713e3cf43
  - kind: waits-on
    to: 01a0d137-0ca1-7572-ae3b-6bb3e6f9bdcc
  - kind: waits-on
    to: 01a0d137-0f5c-70f2-b534-a0cf338247a0
  - kind: waits-on
    to: 01a0d168-f840-7717-8bde-90cff1d9b6a7
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/commands/policy.ts
  - kind: file
    ref: packages/execution-host/src/CallLifetimes.ts
  - kind: file
    ref: packages/executions/src/protocol/command.ts
---
This is stage 3, part 3 of [[13e3cf43]]: program rules take effect. The wire rises once, counted from whatever version stands when this lands.

**Scope**
- **The wire:**
  - admission carries the program rules copy (`packages/executions/src/protocol/command.ts`);
  - the summary carries per-process endings: the process, the rule, and the ladder step it ended at (`protocol/stop.ts`, `ExecutionSummary`);
  - new fields are optional, so stored rows still decode.
- **The server:**
  - resolves a thread's program rules at admission, the project's first and then the thread's (`terminals/commandPolicy.ts`), and keeps the copy on the command record;
  - `write_command_rule` stops refusing program rules. It refuses a program folder that is absolute or climbs out of the project with `..`, because the matcher ([[a9482b3a]]) resolves such a folder against the root as written;
  - overlap answers cover program rules as [[13e3cf43]] defines them.
- **The host,** on the set and watcher of stage 3 part 1 and the matcher of part 2:
  - a matched process's clock starts at the round that first matched it;
  - matching is redone on exec or chdir;
  - a matched process bounds its whole subtree, and nesting only shortens a limit;
  - when a limit runs out, the matched process and its proven subtree go down the ladder of [[f86edb6b]], and the rest of the command runs on;
  - a rule written after a command starts does not bind that command.
- **The default yields.** For a call whose deadline came from the default, the watcher keeps the deadline at the later of the default's own instant and the latest end among live covered processes.
  - These are ordinary `CallLifetimes.ts#revise` revisions with origin `default` and cause `rule`.
  - The deadline moves up as soon as a covered process is matched, and down, never below the default's instant or the present, when covered processes exit.
  - A caller's time and a whole-call rule's time never yield.
- **The answers:**
  - the `bash` answer and a background command's ending notice name each process a rule ended, with its rule, and each process that could not be ended or read (`ShellRun.ts`);
  - the command's read shows the program rules copy, the proven set's size, whether it is watched, and why not.

**Proof:** acceptance criteria 1 to 8 of [[13e3cf43]] on macOS. The typecheck is clean, and the execution-host, harness and tool suites are green for this change.

**At finish:**
- Write the claims from the code.
- Re-read the claims over `CallLifetimes.ts` and [[8cb4e34f]]'s claims on program rules being refused.
- Close [[13e3cf43]] into the claims.
- Landing needs a restart with no live executions. The operator does it.
