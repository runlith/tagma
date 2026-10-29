---
id: 01a178ee-7f00-7383-9708-fb47fb78444d
title: "revertLines.itest \"a deleted file whose permissions are unrecorded\" is red on HEAD: the rollback preview never names the deleted file"
ord: 80
tags: ["task"]
fields:
  {
    "holder": "tagma:01a178ee-aba4-7666-9af1-69b352bd81bc",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a178d0-00df-76b7-a820-8ef6414c146a
---
`revertLines.itest` "a deleted file whose permissions are unrecorded" is red on HEAD: the rollback preview never names the deleted file.

The cause of the `revertLines.itest.ts` failure is confirmed: `ead1f98f79` added a `CheckoutPaths.rootsWithin` call to `Intake.basis`, but the `recordOver` fixture used `gitCheckoutPaths`, where that member defects. `checkoutFixture.call` turned the delete refusal into ignored text; the file stayed on disk and no record appeared. The scenario moves to a real `CheckoutPaths` with fixed coverage of its own checkout and to `toolPrepare`/`toolExecute` with the thread caller and result checks. Before the fix that door showed `Tool.Failed: [delete] error: a git checkout double does not list the checkouts inside a directory`. Checks: the whole `revertLines.itest.ts` green on `--no-isolate --randomize --seed=1`, `2`, `3` (14 tests each), removal itests — 13, metadata — 6; server `bun run typecheck` green. No product behaviour changed.
