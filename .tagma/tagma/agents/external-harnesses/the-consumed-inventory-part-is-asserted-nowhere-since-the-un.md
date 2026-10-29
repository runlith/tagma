---
id: 01a0c98c-d0db-7a08-a213-7e7aefae1b44
title: The consumed inventory part is asserted nowhere since the unit test's deletion, and the refusal test is tag-only
ord: 176
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0c8cb-04b0-7a61-a0bc-0e38d7884fad
---
Found reviewing [[d7884fad]]'s fix (`5b2999ccc8`), which moved the unpaired-deferred refusal from a constructor throw to `invalidRequest` in `present` and deleted `ClaudeCodeTools.test.ts` whole.

Deleting that file took one contract with it that nothing replaced. `tool.inventory`, the `ToolSearch` and `DeferredToolPlaceholder` declarations (`ClaudeCodeTools.ts:39-44` — the placeholder being what keeps deferred loading active on the real wire), and the consumed bookkeeping text part (`:55`) are split: the direct `DeferredToolPlaceholder` declaration is now asserted on the wire (`ClaudeCodePresentation.itest.ts:69-71`, names plus `defer_loading`), while `tool.inventory` and the consumed bookkeeping text part are still asserted nowhere — `rg` over the tests for `deferredTools|DeferredToolPlaceholder|inventory` finds only the surviving file's fixtures otherwise. The refusal moved to the owner; the wire-shape it protects did not.

Two smaller gaps from the same review:
- The new refusal test asserts only the tag. With `process.env.SHELL` unset, `remindersOf` (`ClaudeCodePresentation.ts:455`) fails with the same `LLMError`/`InvalidRequest` shape whether or not the guard exists, so the assertion would green a missing guard. It is non-vacuous only in an environment where the earlier step succeeds.
- The message lost the offending names: the old one appended them, the new one is static. No contract depended on them, but a failure no longer says which tool.

Fix at the owner: assert the consumed inventory part against the wire somewhere a refactor can break (the placeholder declaration is already covered by the itest above), and make the refusal test distinguish this refusal from the one above it (a message or a distinguishing field).