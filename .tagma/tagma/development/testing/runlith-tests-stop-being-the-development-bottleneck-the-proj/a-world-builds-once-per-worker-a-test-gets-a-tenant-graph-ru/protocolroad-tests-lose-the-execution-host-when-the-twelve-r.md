---
id: 01a18e32-4bbd-7a2a-9161-3ca007a3650c
title: protocolRoad tests lose the execution host when the twelve rig files run in one process
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18d5f-d1a2-7ec4-8e80-38ffb97302f1",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a18d5f-315e-7cf6-89b8-16def116d3cd
---
Rig suites that share one `testbed bun test --no-isolate` process sometimes stop: every later test hangs 180 s, either on `WireUnavailable` (`packages/executions/src/WireSession.ts:253`, a `SocketOpenError` on the host socket) or on a wait that never wakes.

**Bun turns one timeout into a cascade.** Bun 1.4.4 sends SIGTERM to every child process the test runner tracks whenever any test or hook times out, not only the timed-out test's own. `detached: true`, `node:child_process` and spawns from `beforeAll` or a timer are all killed; only a process spawned at module load survives. This is upstream oven-sh/bun#46373 (open), regression from #22534 in 1.2.23, fix proposed in oven-sh/bun#45081 (not merged); there is no flag. `startHostFixture` now launches the holder as a background child of `/bin/sh` in its own process group: the shell ignores TERM, the holder gets the default disposition back and the test's stdin pipe through fd 3, so its `with-parent` lifetime still ends it when the scope closes stdin or the test process dies. A probe with a real 50 ms timeout in the same process printed "killed 1 dangling process" and the fixture host still vacated on EOF with code 0. The shell gets its own group because `endHosts` kills the group of every process whose arguments name the root, and the shell's do.

Hosts a test server starts itself (`terminalRuntime`, `doorFixture`, `server.ts` boot with `stdin: inherit`) are spawned by product code inside the test process and are still killed by the cascade; only fixture hosts survive it.

**The first stop was a wait, not a lost host.** Reproduced with seed 2 while two other `protocolRoad.itest.ts` runs ran beside it: the run hung in "a live session copy answers through the ACP extension" with its holder, host logic, socket and agent all alive. The test waited on `held.of(threadId)`, memory no change signal covers: by the code order (inferred, not traced), the protocol step commits the agent's `usage_update` and publishes the thread before the reactor holds the session copy, so the last wake read nothing and the held turn sent no other. Its two waits on held copies now poll. Six concurrent full-file runs (seeds 2–7) then passed 17/17.

Checked and ruled out: `endHosts(root)` substring matching. Roots are mkdtemp directories with a fixed-length random suffix inside the per-process run directory, so no root is a substring of another world's arguments. The replacement host `replaceHost` starts lives in the rig scope, which holds its `Subprocess` until teardown; nothing closes its stdin early.

**Not established.** Whether the recorded `WireUnavailable` losses (batch at f38b881c, `/tmp/rig-history-f38-s1.log`; standalone seed 1, `/tmp/runlith-test/reports/run.62098.1793388565461.jsonl`) had the same cause; they predate these fixes and did not recur in the runs above.

**Done earlier.** The false green is gone (834f58dfcf): the 22 server suites that skipped without `libexecution_platform.dylib` now always run, since their hosts come from the host bundle world whose build prepares the native release itself.
