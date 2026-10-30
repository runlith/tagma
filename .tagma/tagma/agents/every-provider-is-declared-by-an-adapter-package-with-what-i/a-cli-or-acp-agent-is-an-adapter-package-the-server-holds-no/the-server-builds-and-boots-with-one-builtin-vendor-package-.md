---
id: 01a18d5f-d162-74ec-b7f8-f900b60e3ad5
title: The server builds and boots with one builtin vendor package removed, and none of its code ships
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a188ae-2d0b-74f2-91fc-f0e9ba085af5",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a18cbf-97fc-7f17-bc60-685157787448
  - kind: waits-on
    to: 01a18d5f-6f01-75b8-81ef-003b8cc83f67
  - kind: waits-on
    to: 01a18d5f-6f42-72f4-a04e-6d5e29b14a0e
  - kind: waits-on
    to: 01a18d5f-6f9f-791b-a661-e0bf3bd6b3d6
  - kind: waits-on
    to: 01a18d5f-6ff2-76f6-a95c-553c3a4752ab
  - kind: waits-on
    to: 01a18d5f-862b-73c3-8598-6617dc84f88b
---
Acceptance 8 of [[57787448]] and 5 of [[6f376186]], proved once after the last vendor landing: one builtin vendor package removed from the server's dependencies and host modules; the build and boot succeed and the bundle carries none of its code. Then close both specs if nothing else is open.

Known blocker: release packaging names a vendor by hand. `installation/cut/packages.ts` declares `OPENCODE = '@opencode/cli'`, and `installation/cut/release.ts` lists it in `CARRIED_PACKAGES`. A release without the OpenCode package would still try to carry its CLI. The release cut has to take the runtime packages to carry from the builtin adapter packages' own declarations.

**Done.** 4d2d3c8424: the cut walks the server's workspace dependencies and carries what each declares in `tagma.carried` (OpenCode, the Cursor SDK, oxc-parser, typescript, pdfium and sharp all declare there now); on this checkout it yields the same packages, binary, bundle externals and load probe as the hand-written list. e00c55635e removed the empty builtin harness catalog.

**Proof, once, on a detached worktree at e00c55635e** with `@runlith/adapter-opencode` removed from the server's dependencies, its three composition entries and its session signer, and its one server test: `bun install`, then server typecheck clean except two errors standing at HEAD in other files; the release's own `nativeCarried` carries no `@opencode/*` package and lays no binary; `bundle` of `composition/server.ts` and `entries/cli.ts` with release conditions takes 0 OpenCode inputs and no OpenCode marker (`@opencode/client`, `OPENCODE_SESSION`, …) against 21 and 27 inputs and markers in both bundles of the control at the same commit; `harnessAcceptance.itest.ts` and `askChoiceStep.itest.ts` boot the full server runtime on the builtin adapters and pass 4/4. The worktree was deleted.