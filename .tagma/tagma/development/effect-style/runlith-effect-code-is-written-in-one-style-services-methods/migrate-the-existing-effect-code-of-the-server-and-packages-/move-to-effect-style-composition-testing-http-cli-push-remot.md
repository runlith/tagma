---
id: 01a13f2d-638d-74e9-8a14-33acd1cc7192
title: "Move to Effect style: composition/testing http, cli, push, remote, plugins, workspace, installation and root tests"
ord: 37
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c19-2ae9-7a08-9bb0-ae79b53cb89b",
    "status": "done"
  }
edges:
  - kind: waits-on
    to: 01a14c18-c833-7d88-b3bd-66ec88ce8e39
  - kind: waits-on
    to: 01a14cc7-ddbf-77b9-871f-6de7db2bf84a
  - kind: waits-on
    to: 01a14cdb-52d7-7975-a4d8-f425959e8fe9
sources:
  - kind: dir
    ref: apps/tagma/server/src/composition/testing/cli
  - kind: dir
    ref: apps/tagma/server/src/composition/testing/http
---
The tests of the `http`, `cli`, `push`, `remote`, `plugins`, `workspace`, `installation` directories and the top-level files of `apps/tagma/server/src/composition/testing` (about 276 old-runner sites as of 2026-10-15) go to `@runlith/effect-test`; useless ones are deleted under rule 4f387de2. Proof is zero effect-style findings for these paths, tests green.

Final sweep of the temporary Promise boundaries: `createRuntime` → `composition/server.ts`, `runtime.itest.ts`, `testing/restartDataset.ts`, `socket/live.stest.ts`, `native-harness/threadInstructions.itest.ts`, `cli/nativeSignature.itest.ts`, `http/changeRecord.itest.ts`, `executions/{hostChange,hostBoot}.stest.ts`, `executions/commandFeed.bench.ts`, `threads/{threadArchive,birthPlace,protocolRuns,teamPlaces,rolloutDrill}.stest.ts`, `threads/{saidFill,listWindow,shelf,readerOrder,lifeScale,subtreeDelete}.itest.ts`, `threads/parityWorld.ts`, `threads/threadArchive.bench.ts`; `doorWorld` → remaining HTTP files, `remote/door`, `plugins/agents`, `cli/nativeSignature`, `pageWorld`, `performance`, `tracing`, `worktreeTools`, `landing/place`, `enforcement/copiedLaw`, part of `threads`, `native-harness/{directoryWarmth,threadInstructions,compactionSummarizer,evidence,activityWindow.bench}`, `native-harness/modelDefaults`, `workspace/repositories/listing`; `graphFixture.open/release`, `DemoGraph.{run,as,refusal,refusalAs,nameOf,table}`, `prepare`, `rootFixture.open/release`, `tempRoot/tempRepo/git` → remaining graph/enforcement/reflections/threads/executions/landing tests, `finishingFixture/listingRig/landingFixture`, root Worktree/operationRefusals/settings/tracing, `plugins/background`, `native-harness/{threadInstructions,composeAgent,library}` and direct tests of the plugin-secrets/views/plugins/mcp/workspace/native-harness modules; `terminalWorld` → direct `cli/{operatorMechanics,reply,upgrade,mcpScope,exitCodes,documents,terminalDeclaration,mcpDeclaration,projections,views,project}` tests, `composition/testing/{place,commitFixture}` and `cli/{runnerRig,hookAdoptionRig,hookIngress.bench,worktree,threadEvidence,hookPlace,hookRecord,hookLaw,hookReport}`; `captured` → `captureDriver`, `threads/{terminalRuns,rolloutDrill,naming}`, `speech/controls`, `cli/{nativeSignature,hookRecord}` (a line with the name in graphTools does not count as an API import); `spawned` → remaining process tests and helpers, including CLI/HTTP/worktrees/installation/graph, `programFixture`, `preparedTreeFixture`, `sandboxFixture`, `threadDoors`, and `executions/host/processes.ts`. The exact current populations come from one `rg -l` for `\bcreateRuntime\b`, `\bdoorWorld\b`, `\bDemoGraph\b|\btempRoot\b|\btempRepo\b`, `\bterminalWorld\b`, the `\bcaptured\b` import and the `\bspawned\b` import from `testing/spawn` under `apps/tagma/server/src` (the adapters' own declarations are excluded; one graphFixture import does not yet mean a Promise call — check .open/.run/.release). `syntheticRelease` → `release-channel/{install,runner}.itest.ts`; `composition/testing/installation/applicationCopy` uses the native `syntheticReleaseEffect`. The last migrated consumer removes its adapter in the same change; before the final sweep these boundaries are not declared removed.
