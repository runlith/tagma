---
id: 01a14c37-8df2-7894-9881-0dc776a24cc2
title: File tool descriptions and the worktree dialog must say what the tools do
ord: 37
tags: ["task"]
fields:
  {
    "status": "open"
  }
---
- `edit`: the description and refusal require an exact match, while `replace` falls back to whitespace-, indent-, and escape-insensitive matching.
- `rename`: promises both paths inside the working directory, while the directory assembles with `allowOutsideCwd: true` (`native-harness/capabilities/worldTools.ts`).
- `write` and `edit`: the path "must be absolute", while a relative one resolves from the root (`workspace/paths.ts#workspaceTarget`).
- The new worktree dialog: "Agents started in it write nowhere else", though file tools reach any path. Don't build isolation (agents are trusted) — fix the text.
- The `list_worktrees` grammar doesn't name the `reading` and `unread` statuses the rows carry (`worktrees/listing/rowEntries.ts`).
