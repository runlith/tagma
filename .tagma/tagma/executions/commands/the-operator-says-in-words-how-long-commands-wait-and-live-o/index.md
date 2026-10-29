---
id: 01a14c14-6895-75c6-80f2-47ba005523c3
title: The operator says in words how long commands wait and live — on the machine, in the project, or in the thread, down to a single program inside a command
ord: 3
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/commands/ruleResolution.ts
  - kind: file
    ref: apps/tagma/server/src/executions/contract/wire/operations/commandRules.ts
  - kind: file
    ref: apps/tagma/server/src/executions/operations/commandRules.ts
  - kind: file
    ref: apps/tagma/server/src/executions/store/standingRules.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/turns/commandRules.ts
  - kind: file
    ref: packages/execution-host/src/ProgramRules.ts
---
**Value.** The operator says once "typecheck gets no more than five minutes" or "in this thread we wait no longer than a minute on commands", and it applies to every matching command, whatever the agent passes in the call.

**How.** The agent records the rule in the operator's words: `write_command_rule`, `remove_command_rule`, `read_command_rules`; the same operations via `tagma op`.

**Behaviour.**
- Three ordered lists: machine, project, and thread. Inside a list the last matching rule wins; between lists the lowest figure wins. A rule only shortens what the call names, and a call that names none takes the binding figure instead of the default.
- A whole-call rule covers the wait and life of `bash`, and with its life also the law checks and commit steps the server runs.
- A program rule limits the life of each process of the command matching it by program or interpreter-script name, arguments, and folder: when it expires, that process with its descendants stops, and the rest of the command goes on.
- The write answer names the rules the new one overlaps and the ones overlapping it; each rule keeps its words, author, and time.
- The thread sees the rules in force over it in the turn note, and a changed list reaches it as a replacement.

**Limits.** Writing and deleting a rule asks the operator even in trust mode. A program rule does not reach commands already running when it is written. There is no rules screen in the window. Terminals obey no rules.
