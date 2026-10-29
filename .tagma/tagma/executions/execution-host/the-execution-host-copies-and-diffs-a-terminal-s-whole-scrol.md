---
id: 01a0d881-dd85-7dea-9a8d-81b3be16c80c
title: The execution host copies and diffs a terminal's whole scrollback for every viewer on every frame, about 11 points of CPU per open pane of a busy terminal
ord: 63
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d882-0dc1-7c9f-bf6f-b3a443f86777",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0d85d-a269-7532-8c9b-48ced2349d64
sources:
  - kind: file
    ref: packages/execution-host/src/hostLoad.bench.ts
  - kind: file
    ref: packages/execution-host/src/Presentation.ts
---
**Measured on 2026-09-25 by task d2349d64**, on a test host with the live boot policy (320×100 grid, 5000 scrollback rows) and 8 busy ptys. Bench: `packages/execution-host/src/hostLoad.bench.ts`.
- Host CPU: 7% with no Screen viewer, 18% with one, 48–53% with four — about 11 points per viewer.
- Profile of the kept busy windows, idle excluded:
  - `Presentation.styleOf` builds a fresh style object with three nested colour objects for every cell: 28% self;
  - `Presentation.copy` walks the whole buffer, up to scrollback + rows lines × columns, for every viewer on every frame: 19% self, 49% inclusive;
  - `presentationPaint` diffs that whole copy against the viewer's base: about 10%;
  - xterm parsing itself: only 5–10%.
- Every chunk the parser writes produces a frame per viewer.
- The per-cell allocation likely also drives the host's GC threads; that is inferred, not measured.

In the live host, Screen subscriptions come from the operator's open terminal panes (`socket/terminalChannel.ts` → `Terminals.screens`), and the frames also land on the server's decoder (task af5cabcb).

**Fix at the owner:**
- a frame carries and diffs only what changed — the viewport and the new lines;
- styles are shared, not rebuilt per cell;
- a viewer's paint stays the same.

**Done when:**
- the bench's host CPU at 0, 1 and 4 viewers is named before and after;
- the paint suites pass;
- the claims over the changed code are written.