---
id: 01a0d32e-c0ee-79a0-935d-6f77e0546180
title: Make the six execution-host store tests broken by the dead-generation reclaim (2aa167acf6) green, deciding per failure whether the test or the code holds the right contract
ord: 29
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d32e-e6ba-7a39-8d46-2c47f4fd99c2",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/execution-host/src/AcceptedRecovery.itest.ts
  - kind: file
    ref: packages/execution-host/src/EvictedRangeRead.itest.ts
  - kind: file
    ref: packages/execution-host/src/ExecutionRetention.itest.ts
  - kind: file
    ref: packages/execution-host/src/ExecutionStoreLoss.itest.ts
---
Six execution-host tests have been red since commit `2aa167acf6` ("Reclaim dead execution generations and reconcile abandoned starts", 2026-09-19). The operator asked for them to be fixed.

**Measured.** Run in a temporary worktree:
- at `2aa167acf6^`, all 12 tests of these four files pass;
- at `2aa167acf6` and at every later commit, the same 6 fail.

```
cd packages/execution-host && bun test src/AcceptedRecovery.test.ts src/ExecutionRetention.test.ts src/EvictedRangeRead.test.ts src/ExecutionStoreLoss.test.ts
```

**The failures,** as traced by `build-grid-track`:
- **`AcceptedRecovery` ×3.** A START key and a STOP key over a retired, childless ending both answer `Refused` / `IncarnationMismatch` ("the host generation that took this key ended; its detail was reclaimed") where the test expects `Accepted`. `ending(owned)` answers nothing. The refusal and the reclaim of dead generations both came in `2aa167acf6`. The test last changed in `05b33d0f7a` (task 38eca50c: "a START key reads a retired childless ending off its filed final facts").
- **`EvictedRangeRead` "sealed record" and `ExecutionRetention` `partial` → `lost`.** Both call `registry.forget`. `forgetOf` now removes the record directory and files `retention: 'lost'`, so the sealed record is gone before the test reads it back.
- **`ExecutionStoreLoss` "Started receipt the writer died under".** The stubbed `recordState` fails with `StoreLost`, and the error escapes where it should be answered as `StoreFailed`.

**What to decide first, for each failure:** which of two contracts is right.
- Either the test's contract still holds, and `2aa167acf6` broke a promise the product still needs. For example: a retry of a START key after a host restart must still read its execution, and a forgotten execution's sealed output is still readable.
- Or the reclaim changed that promise on purpose, and the test pins a contract that no longer holds.

Read the commit, what it was for, and the claims over these paths before choosing. A test is never weakened just to turn it green. If the code broke a promise the product still needs, fix the code at its owner. If the promise changed on purpose, rewrite the test to the new contract, and have a claim state the new contract.

**Proof:**
- all 12 tests of the four files pass;
- the host suite is green under the residue guard;
- the typecheck of `packages/execution-host` is clean.
