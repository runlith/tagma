---
id: 01a12c8c-bb33-7046-8693-43d334f1c8f6
title: Shell delivers law over file operands and recognized search/diff sites
ord: 1
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12c87-c1d2-75a6-8659-57b77f4ba154
sources:
  - kind: file
    ref: packages/agent-tools/src/shellShown.ts
---
A process's output and a literal argument never prove a file read on their own. The shell hint parses argument roles past the launch wrappers: recognized inline code, filters, SQL, and program parameters never become file operands. It keeps the true filename spelling, resolves a bare `~/` operand only when the caller supplies the shell home, and recognizes search/diff only by their format; ANSI is presentation. Native launch and recognition share one effective environment snapshot, including per-call overrides. Search output with no filename stays data: an ordinary search over one confirmed file yields no search sites, while `-H`/`--with-filename` and `-h`/`--no-filename` set that format explicitly. The resulting places are confirmed by the file provider through one probe (`fileProbe`), shared by native bash and the harness hooks: a name the file system refuses — missing, unreadable, not a file, or too long to name one, as a long message body is — is no file, and only another failure leaves the command's places unconfirmed. A search by a tool without a shell (Claude Code Grep) arrives from the hook as a separate `HarnessPrinted` kind — a list of found paths plus output — and `searchShown` reads it as search sites: in its output a path stands without a command, and in a single-file search it does not stand at all. This heuristic list delivers law after the command and never serves as proof of authorship of its writes.
