---
id: 01a17136-9d87-7e43-bada-bcc7fdf1f592
title: "A terminal-CLI bash call is its thread's command: the pre-hook report opens the window, the closing report lands it"
ord: 8
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/terminal/commands.ts
  - kind: file
    ref: packages/agent-tools/src/bash/witnessed.ts
---
A terminal-CLI bash call of its thread is that thread's command: the pre-hook report opens the window, the closing report lands it.

Tagma never launches its own thread's Bash CLI (Claude Code in a Tagma terminal), so without a window its writes landed unowned (`external`): a session landing with a record never carries unowned lines next to its own, and the commit diverged from the verified working file. The call measures through the same loop as native `bash`:

- The Bash call's `PreToolUse` carries the event's `shell` in its report — the command and the event's directory. After the report commits, `TerminalEvents` calls `TerminalCommands.opened`: the event directory's checkout, the thread's home project, and the kit witness (`commandWitness`) — `preflight`, `ShellRun.open` (the window in the journal, the "before" measurement), `opened`.
- The report closing the same call (`done`: the `PostToolUse` or `PostToolUseFailure`) lands the window: the "after" measurement, shifts, verdicts. The turn end (`turn-end` of the thread itself) lands windows whose closing report never arrived: a call interrupted by Esc or denied permission.
- Authorship judges through the usual window machine: a path named by the command line is the thread's line, and a write outside the call stays unowned.
- The process belongs to the CLI, its outcome and price unknown, so the witness world has no `commands`: Tagma's command statistics never count such a call.
- Windows live in server memory between reports; a restart-caught open window is decided by the journal (the `restart` reason). No window opens outside a registered checkout, or for a refused or repeated event (`refused`, `duplicate`); an open failure logs and leaves the writes unowned.
- The hosted runner (acp) never reaches here: its bash runs the native Tagma tool.
