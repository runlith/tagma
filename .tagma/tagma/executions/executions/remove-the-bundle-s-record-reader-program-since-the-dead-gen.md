---
id: 01a0d34b-aa13-7384-bba4-0c4d6e36e880
title: "Remove the bundle's record reader program: since the dead-generation reclaim no host leaves a sealed record for it to read"
ord: 30
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d34b-cbf0-75ba-ada8-75fbb3a6368d",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0d32e-c0ee-79a0-935d-6f77e0546180
sources:
  - kind: file
    ref: packages/execution-host/src/buildArtifact.ts
  - kind: file
    ref: packages/execution-host/src/reader.ts
  - kind: file
    ref: packages/executions/src/protocol/artifact.ts
---
The record reader (`packages/execution-host/src/reader.ts`) is shipped in every host bundle as the `reader` part (`buildArtifact.ts#READER_ENTRY`, `packages/executions/src/protocol/artifact.ts`). Its stated reason is that "a sealed record outlives the process that wrote it", so the bytes of what ran stay readable when no host is running.

Since `2aa167acf6`, that premise no longer holds:
- retiring an execution (`forgetOf`) removes its record directory ([[8f8801c5]]);
- a new host generation deletes the records of the one it replaces ([[175e0321]]);
- per [[e2910415]], no host leaves a sealed record of work that ran.

The reader therefore ships in every bundle, and is tested in `bundleBoot.itest.ts` and `hostBoot.itest.ts`, with nothing left to read. The operator left the choice to what is best for the system. Dead code shipped in every bundle is a cost with no reader, so the target is to remove the reader.

**First, check the premise.** Look for any road on which a record of finished work still stands on disk while no host runs, and would be sealed and readable there:
- a host that exits, whether ending its work (`b13590d5`) or detached;
- a host that crashes;
- the window before the next host boots on the same state directory.

If such a road exists and a user could meet it in practice, stop and report it with the evidence; do not delete anything. A window of seconds before the next boot, which the server opens itself, does not count as practical.

**Then remove:**
- `reader.ts`;
- the `reader` part from the artifact vocabulary and from `buildArtifact.ts`;
- every server reading of that part;
- the tests that only exist for it.

**Compatibility:** a manifest of an installed bundle that still lists `reader` must still be read, or must be refused in a way the server already handles for an older artifact. Choose by reading `hostOffer.ts` and how the server treats artifact versions, and say which you chose. If the artifact or the wire version must move, say so before moving it: `build-control-out` is raising `WIRE_VERSION` to 28 in its working tree right now.

**Also:**
- delete or correct every claim that promises a readable sealed record without a host;
- keep `RecordFiles` and the record-level readers the host itself uses, which live executions need.

**Proof:**
- the artifact builds;
- `bundleBoot.itest.ts` and `hostBoot.itest.ts` pass without the part;
- the typecheck is clean in `packages/executions`, `packages/execution-host` and `apps/tagma/server`;
- the host suite is green.
