---
id: 01a14c13-c481-7acc-8aa6-03b2bc597e66
title: The agent finds files by mask and text by regex via ripgrep — freshest first, in pages
ord: 3
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/capabilities/shell.ts
  - kind: file
    ref: packages/agent-tools/src/glob.ts
  - kind: file
    ref: packages/agent-tools/src/grep.ts
---
**Value.** Searching a large repository answers in fractions of a second and doesn't walk dependencies and builds git ignores — unlike `find` and `grep -r` in a shell.

**How.** The native agent's `glob` and `grep` tools; they come with the shell capability, not files.

**Behaviour.**
- `glob` answers paths by mask, newest by modification time first.
- `grep` is ripgrep regex with a file mask or type filter and three answer kinds: lines with context, files only, per-file counts; files — freshest first.
- The answer is a page with a total and continuation cursor; inaccessible paths are skipped, and the answer says so.
- Found places carry their place's law and notes (delivery — A4).

**Limits.** An agent without the shell capability doesn't get these tools. Git-ignored isn't walked by ripgrep.
