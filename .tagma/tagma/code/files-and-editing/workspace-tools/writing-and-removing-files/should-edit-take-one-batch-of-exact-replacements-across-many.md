---
id: 01a0de2b-4715-7996-b485-311e41d47ad3
title: Should `edit` take one batch of exact replacements across many files, so a mechanical sweep keeps the typed door's guarantees?
ord: 14
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a0d09f-1bf6-7559-85f2-6a187d2e8618
---
Raised by [[7d2e8618]]: a builder ran 47 Python scripts from its scratch, each rewriting several checkout files, because dozens of `edit` calls cost more steps.

What stands now (read 2026-09-26):
- The shell refuses a single literal-path write but runs a script that writes many; the doctrine (`typedTools.ts`) allows a script only for one mechanical change across many files and, since [[fbccc7f3]], names `produces` so its writes land as the session's own.
- `produces` records the writes and refuses a path another session holds before the command runs, but the prose law is not asked: a script can add comments the `edit`/`write` doors would strip ([[40c40bd2]]).
- `edit` takes one path and one replacement.

The open choice is the operator's: a batched `edit` (each file fenced, holder-checked, prose-stripped and recorded, all-or-nothing) versus asking the prose law over `produces` claims versus leaving scripts as the road. What would inform it: how often threads run multi-file replacement scripts, and what one more tool-schema shape costs every agent's prompt.