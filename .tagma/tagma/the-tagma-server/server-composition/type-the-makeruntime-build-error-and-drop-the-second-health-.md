---
id: 01a15120-d78e-76a6-8c25-1763cd1dfa0f
title: Type the makeRuntime build error and drop the second health-response form in the CLI door
ord: 21
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15121-449b-71b0-9b35-4b2342d88bd3",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/cli/door.ts
  - kind: file
    ref: apps/tagma/server/src/composition/runtime.ts
---
Type the `makeRuntime` build failure and keep the single current `/health` contract in the CLI door under [[acb620dd|the one-form rule]].

Landed: `RuntimeFailure` unites `AssemblyInvalid` and `serving`-layer errors — effectively `AssemblyInvalid | PreparedInstanceFailed | StoreFailure`. The second decoder, `Older`, its types, and consumer branches removed. `healthSchema` requires `stalled: null | object`, like the current producer; a malformed response ends in an error instead of passing for a missing server. The `readHealth` resolution in swallowed-failures removed; [[c352d5ea|the stalled explanation]] reconciled.

`Older` was read by `installation/cli/server.ts`, `installation/cut/came.ts`, `installation/cut/try.ts`, `installation/voice/status.ts`, and `checkout-builds/cli.ts`. This branch did not hand the process to the successor: restart/build/update refused, cut offered a manual launch, status printed a partial state. The live handover uses `restart_server`, the launch record, and waiting for current health; that path is kept. The working server was not restarted.

Checks: `bun run typecheck` in `apps/tagma/server` before the finding fix — exit 0, 5073 files; five targeted suites — 35 pass, 0 fail; after mandatory `stalled`, the CLI door again — 4 pass, 0 fail. An independent [[01a15126-8f9f-7e09-b934-226c86e926bb|review]] of the whole delivery found optional `stalled`; the finding was confirmed against the producer and fixed. Rule checks at submit_work passed.

A full green typecheck of the resulting shared tree stays unconfirmed: the last run reported 16 errors in 10 foreign files from an unfinished paging API change, notably `TS2305: Module '"@runlith/paging"' has no exported member 'cursorSelection'` in `packages/agent-tools/src/pageFamilies.ts:2`. It reported no errors in this delivery's files; foreign changes were not fixed.
