---
id: 01a15442-9975-74b3-a638-76af59c2f991
title: A terminal launched right after Tagma start refuses HostUnavailable instead of awaiting the execution-host raise
ord: 25
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15408-568d-7e1e-8e37-c0a71edd2bea",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/host/custody.ts
---
At the 0.1.5 cut (2026-10-19) the trial run placed the previous cut 0.1.4 in a clean world and called `start_terminal` right after `add_project`. It answered 409: `terminal-host-state: The host refused this launch: HostUnavailable — the execution host could not be read: unreachable: the socket could not be opened (Unknown): connect ENOENT …/home/.tagma/executions/<installation>/…`. The host bundle had been laid 1.2 s before the call ("the host bundle this installation offered now stands at …"), but the host socket didn't exist yet. The repeat cut passed, but the terminal step didn't run in it: a trial run with update only runs when the previous cut's version differs from the new one. So the failure's reproducibility is unestablished.

Initial hypothesis: a terminal start in the first seconds after server launch doesn't await the execution-host raise and answers `HostUnreachable` (`executions/host/custody.ts`, `detailOf`), while it should await the readiness fact, as the wait-on-fact rule requires. The user meets this as a refusal of the first command or terminal right after opening Tagma.

Where to start: find who raises the host after the bundle is laid and how `start_terminal` gains custody while the host doesn't listen; reproduce on `tagma:try` or a trial world (`installation/cut/world.ts`, `held`) with a terminal start right after `/health` readiness. Proof — a terminal-start-before-host-raise test that awaits the host and launches the terminal.

Cause: a release opened after `install-from` accepts the execution host in a background fiber after the door already (`takenAfter` in `executions/assembly.ts`), while terminal start and cancel went for custody at once. On a clean machine the socket didn't exist yet (`HostUnavailable`); over a standing foreign-build host came a bundle-mismatch refusal.

Fix (75dc4e1d1c): `makeTerminalHostCustody` takes `ready`, and start and cancel await it. Assembly on the `takenAfter` path hands it a Deferred that closes when host acceptance ended in success, failure or interrupt. On the ordinary path the host rises before layer readiness, so there is nothing to await.

Proof: in `hostChange.stest.ts` a terminal starts before the release door with `takenAfter`. With the fix it waits and launches after host acceptance; without the fix it refuses `op-before-door did not start: Refused`. The file passed whole: 5 pass.

Unproven: the cut trial run itself with update (cut N → N+1 with terminals) wasn't run after the fix. It will run at the next cut whose previous cut is another version.
