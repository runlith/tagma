---
id: 01a17d2b-a3ce-7ada-b5b4-0afe62f2a425
title: Command deletion by glob or find -delete receives an author like deletion with an explicit path
ord: 81
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17d2b-e399-7992-95f4-6f8d38ddee6b",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a116e8-e341-7861-a5f6-564c65835438
  - kind: relates
    to: 01a17d2b-48ac-715a-8c97-6723a90d31cc
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/record/roles.ts
  - kind: file
    ref: packages/agent-tools/src/shellFacts.ts
---
A command-line deletion receives an author only when the command line names the path literally: `rm dist/a.js` and `rm -rf dist` shift the thread, but `rm dist/*.js`, `rm -f *.log` and `find build -name '*.map' -delete` are opaque writers (`unresolvable` in `shellFacts.ts` returns `named: null`). Such a deletion comes out `unproven` even next to the only living command, and the agent must name the paths in `submit_work` `paths`. Deletion by pattern is routine agent work in any project.

What changes: an operand pattern of `rm`/`rmdir` (and of the other commands in `OPERANDS_WRITE` where it holds) names the pattern, and `find <roots> … -delete` names its roots as subtrees. The shift is explained by a command whose pattern matched the path under shell glob rules: `*` and `?` do not cross `/` and do not match a leading dot, `[...]` classes and brace alternatives expand to a glob. Variables, command substitutions and `~` stay opaque: what they name is visible only after execution.

The command role is stored in the window and read after restart, so the new role form reads windows recorded before it.

Acceptance: `rm dist/*.js` and `find build -name '*.map' -delete` next to a neighbouring opaque command of another thread give their own thread's shifts; a path the pattern does not fit is not explained by the same pattern.
