---
id: 01a113c8-ea78-7cac-906f-6e35921f3a5a
title: ProgramRoad knows a missing tool by its marker and trims arguments to the line limit, and an interrupt stops the process with its children
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/commands/admitted.ts
  - kind: file
    ref: apps/tagma/server/src/executions/commands/programRoad.ts
---
The program is launched by the host shell, which first checks `argv[0]`: a name without `/` via `command -v`, a path with `/` as an executable-bit file, because dash doesn't check the latter. Absence answers with the `tagma-program-missing:` marker with `PATH` in stderr and code 127, and `ProgramRoad` turns it into `Unrun { missing }`; the same 127 without the marker is the tool's own ordinary exit, judged by the caller against its `ok`.

`chunk` trims paths so the launch line stays within `LINE_BYTES` with headroom for the environment; chunks keep order and are never empty. The limit is one because `ProgramRoad` today launches only `/bin/sh`: Windows will be a separate adapter behind the same contract, not a branch here.

The launch tool (`tool`) is named by the caller — `inspection`, `commit-step` or `config` — and command rules pick the time ceiling by exactly that. If the caller was interrupted, `admittedCommand` stops the execution together with its children before returning control: otherwise the process would keep writing into the next landing's tree. Accepting the launch isn't interrupted until the reference arrives and the stop is installed: a native process may start working before the accept answer, and an interrupt in that window would otherwise leave it alive. Target resolution and admission preparation run before that window and are interruptible: nothing goes to the host from them. The host-handover wait that the start itself begins with is also interruptible: nothing is taken before it. The caller recording the accepted reference and observing further are already interruptible under the installed stop.
