---
id: 01a13d51-317b-7b59-99ed-1476a01ffa22
title: "makeAgentRunner is an effectful make: launch scope at the caller, no Scope.makeUnsafe and no manual dispose"
ord: 30
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c17-b1ec-77e1-b49d-4fb1178ad9cf",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13d2f-397e-77cc-90c3-6f023cd163f7
  - kind: waits-on
    to: 01a13d30-d804-7b33-9b8b-12527b27377d
sources:
  - kind: file
    ref: packages/agent/src/agent/AgentRunner.ts
---
`packages/agent/src/agent/AgentRunner.ts` `makeAgentRunner` holds `runs = Scope.makeUnsafe()` and a `dispose()` that closes it only if the owner remembered to call. The shape is left over from the class in the migration (3cd163f7). The goal is an `Effect.fnUntraced` make, `runs = Scope.fork(yield* Effect.scope)`, closing by the caller scope's finalizer, `dispose` gone. The `runs` life does not outlive the caller scope (kernel.ts and captureDriver.ts already hang a finalizer with dispose).

The same path awaits two per-run objects currently assembled from already obtained services: `ThreadStreamRecorder` (with `threadInterruptions`) and `ThreadContextAnchor`. Their shape is a make that takes tags once when assembling the layer and returns a per-run constructor; the blocker is the same — the `recorder()` test helpers in ThreadStreamRecorder.test.ts and the anchor in ThreadCompaction.itest.ts assemble them through `Effect.runSync` and `Scope.makeUnsafe`.

There are about 20 consumers, each a test or helper outside an Effect scope (AgentRunner.test, DevinRunner.test, conformance hostedCalls/compactionWorld, server itest native-harness, sandboxWorld.stest, protocolRig…), so the fix goes with their migration to `@runlith/effect-test`. Proof is no `Scope.makeUnsafe` and `dispose` in AgentRunner, consumers' tests green.
