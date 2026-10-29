---
id: 01a11268-67c8-749a-8e35-7e50597fdfa9
title: submit_work answers git-unavailable with host-replacement advice when the landing git command is not admitted to run
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a11269-8086-777d-9092-a271e9f71f08",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a11267-f36e-7af6-a2c1-66b3f1e01bec
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/subject.ts
  - kind: file
    ref: apps/tagma/server/src/executions/commands/admittedGit.ts
---
When the landing git command is not admitted to run — e.g. the owner session got `terminal-no-owner` — `admittedCommand.start` turns the `CommandAccess.prepare` refusal into `Unrun`, `admittedGit` into `GitUnavailable`, and `onBranch` answers `git-unavailable` with the unblock “the operator replaces a host that cannot start a process”. The host is healthy at the time, so the advice points at replacing the host instead of the cause. That is how the `submit_work` refusal looked in a thread working under an archive mark ([[f1e01bec|archive and running work]]).

An admission refusal is a typed executions refusal: it must reach the `submit_work` answer with its own code and unblock, while `git-unavailable` stays for the host that failed to start a process.

Start at `executions/commands/admitted.ts` (the `access.prepare` branch in `start`), `executions/commands/admittedGit.ts` and `GitUnavailable` in `@runlith/git`.

Done when the landing git command's admission refusal reaches the `submit_work` answer with the executions code and its unblock, shown by a test through the public landing operation.
