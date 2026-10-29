---
id: 01a14564-656e-7e40-9f43-ef3419f5c986
title: "A wedged Tagma server heals without the user: the writer holder is named, /health is honest, exit and quit have deadlines, the window removes a stuck server"
ord: 126
tags: ["task"]
fields:
  {
    "holder": "claude-code:5e6fa99d-7c0f-4991-9323-91a1704dc193",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/desktop/src/SurfaceLoader.ts
  - kind: file
    ref: apps/tagma/server/src/composition/http/health.ts
---
A server whose machine-database writer is stuck must heal without the user and without Activity Monitor: any exit and relaunch of the window leads to a working Tagma.

The trigger was a case where a `project.birth` transaction held the `tagma.sqlite` writer for 900 s (5 statements, engine 0 ms, outside sqlite 900 s) while every other write waited on it until the 15-minute ceiling. `/health` kept answering 200 throughout. Chip restart and `tagma restart` waited on the same writer during preparation: the migration chain was read through the writer. Stop and Quit waited on exit with no deadline. Force Quit removed only the window, and relaunching the window attached to the same server.

What was done:
- Holding is signed with the work ([[02de86cf]]): a store transaction sets `HeldFor` from its operation, and the threshold and ceiling lines name it.
- The writer answers with its holder and silence ([[2ba7e11f]]).
- The machine store judges wedging, and `/health` carries `stalled` with a pid ([[c352d5ea]]).
- The server exits on its own 60 s after the signal, `quit` finishes it with SIGKILL after 90 s, and restart preparation reads through readers ([[e29c3592]]).
- On launch and while polling, the window removes its stuck server and starts a new one ([[d6920c21]]).

The timeouts come from `serve.log` and `serve.log.1`:
- The longest legitimate machine-store transaction pause outside SQLite is 5.6 s, `ThreadStore.kernel`, with 15.7 s of holding.
- Normal predecessor exits, 25 cases: p50 6 s, p90 27.4 s, max 41.7 s.

Checked:
- `@runlith/held`: 43 tests, including the holder listing and the threshold-line signature.
- `@runlith/sqlite-process`: 17 unit and 42 integration tests; a new test covers a standing writer during and after a statement.
- Window: 25 `SurfaceLoader.itest.ts` tests; a new test covers the window removing its stuck server by pid and starting a new one.
- Server: `junction.itest.ts`, `platform/store` tests, `/health` door tests.
- Typecheck of packages, server, and window.

Not checked:
- A live wedging on a real server was never reproduced end to end.
- Server changes reach a working installation only through build and restart.
- App typecheck fails on other people's `ThreadSlot.svelte.test.ts` and `launch.test.ts` tests (`searching`, `missing` harness fields), untouched by this work.

The root of the wedging itself is [[c681ad09]].
