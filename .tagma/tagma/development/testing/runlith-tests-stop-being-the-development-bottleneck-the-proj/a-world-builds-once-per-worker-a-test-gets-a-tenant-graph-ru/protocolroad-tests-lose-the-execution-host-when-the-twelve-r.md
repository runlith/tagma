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
Rig suites that share one `testbed bun test --no-isolate` process sometimes lose the execution host behind the rig's endpoint: every later `floor([])` hangs 180 s on `WireUnavailable` (`packages/executions/src/WireSession.ts:253`, a `SocketOpenError` on the host socket).

**Measured: Bun turns one timeout into a cascade.** Bun 1.4.4 kills every child process the test runner tracks whenever any test or hook times out, not just the timed-out test's own: a probe where test A spawns `sleep 100`, test B times out without spawning anything, and test C checks A's child shows the child killed ("killed 1 dangling process"). `detached: true`, `node:child_process` and spawns from `beforeAll` or a timer are all killed; only a process spawned at module load survives. A world's execution host is spawned inside a test or hook, so once any test in the process times out, every later test of every world in it loses its host and times out too. This is upstream oven-sh/bun#46373 (open), regression from #22534 in 1.2.23, fix proposed in oven-sh/bun#45081 (not merged); there is no flag, env var or bunfig switch.

**Not found: the first loss.** In both recorded failures the host was already gone before any timeout in that process: in the batch at f38b881c (`/tmp/rig-history-f38-s1.log`) and in the standalone seed-1 run of `protocolRoad.itest.ts` (testbed report `/tmp/runlith-test/reports/run.62098.1793388565461.jsonl`), the first failing test hung on `WireUnavailable` and its own timeout printed the first "killed N dangling processes". In the standalone run the failing test followed `a hosted session whose execution was lost with its host generation`, the one test that calls `replaceHost` (`endHosts(owned)` then a new `startHostFixture`), with one passing test between them. On HEAD 834f58dfcf the order for seed 1 has changed and no host is lost (17 tests, ~15 s); filtered runs of those three tests keep a fixed order and pass. Leads not yet checked: a fixture `endHosts(root)` matching another world's host by substring (`pgrep -f root`, `args.some(arg => arg.includes(root))`), and the `with-parent` lifetime of a host started by `replaceHost`.

**Done.** The false green is gone (834f58dfcf): the 22 server suites that `describe.skipIf(!existsSync(libexecution_platform.dylib))` now always run, since their hosts come from the host bundle world whose build prepares the native release itself (`buildArtifact` → `nativeRelease`); a missing toolchain fails loudly.

**Left.** Find the first loss with a reproduction (the failing order no longer occurs with seed 1), and decide how fixtures survive Bun's timeout kill until #45081 ships, e.g. launching fixture hosts through a parent that ignores SIGTERM, which #46373 reports as the working workaround.
