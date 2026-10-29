---
id: 01a16b01-cb85-7e31-9936-47664dbd9a84
title: "Logic is tested in unit over fast adapters with conformance on real ones, while current itest and stest are dissected: to unit, to a narrow itest, or to deletion"
ord: 10
tags: ["spec"]
fields:
  {
    "status": "open"
  }
---
**What.** Domain logic is tested in the unit layer over fast adapters, while real git, SQLite, processes and disk are checked once — one conformance set per adapter and a few end-to-end paths through the real door. Current itest and stest files (859 and 294) each get one of three outcomes: logic → unit, real boundary → narrow itest, junk under [[4f387de2]] → deleted.

**Where to substitute.** Substitution stands on the port the domain needs, not on the lower boundary.
- **Git.** The `@runlith/git/Git` service is `run(args)`, i.e. whole git argv (`packages/git/src/Git.ts:70-79`); 217 non-test server files use it (most of all graph, enforcement, change-record, landing, workspace, worktrees). Emulating git by argv in memory is a second git; this is not done. A module whose logic must be tested without git declares its own port for what it needs from git (read HEAD, list changes, write a commit — by module meaning), with a real adapter over `Git` and an in-memory adapter; composition fills the port ([[e090f46d]], [[6f758080]]). A port is introduced only where measurement or dissection shows the module's logic is currently checked through a whole world with git.
- **Disk.** Effect gives only `FileSystem.makeNoop`/`layerNoop` — stubs with no state. A stateful in-memory `FileSystem` adapter is written once in the kit ([[3e26831e]]) or taken ready-made if one passes conformance.
- **SQLite.** Storage stays real SQLite: already in-process memory or a file with one pool per worker ([[1687254a]]); no fake SQL is written.
- **Processes.** The executions contract is already separated from the host (`@runlith/executions`); host doubles live in `apps/tagma/server/src/executions/testing`. Dissection shows whether they suffice for executions logic to go to the unit layer.

**Conformance.** One set per in-memory adapter over its port, running on the real adapter (itest) and on the fast one (unit). A product test green on the fast adapter and red on the real one is a divergence: fix it and add the case to the set. An adapter or port change runs the set on both.

**Dissection.** One module at a time, starting with the most expensive per the kit report; modules do not overlap and are dissected in parallel. For each file:
- subject is module logic → test rewritten onto the owner's public operation over in-memory adapters, unit layer;
- subject is real-resource behavior or a path through the real door → stays itest; if the same subject is already covered by conformance, the file is deleted;
- test protects no contract → deleted.

The module's cost before and after is recorded in the dissection report under this spec.

**Acceptance.**
- No `*.stest.ts` files; `test:system` scripts deleted.
- Every remaining itest file checks either adapter conformance or a path through the real door.
- Every in-memory adapter has a conformance set, green on both adapters.
- Every new module port is filled by composition; the module core knows no adapters.
- Every dissected module's cost recorded before and after.
