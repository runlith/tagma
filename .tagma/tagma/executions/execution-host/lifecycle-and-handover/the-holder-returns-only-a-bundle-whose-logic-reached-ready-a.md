---
id: 01a12b39-2d1e-7d71-bf09-ab2fa12fc10c
title: The holder returns only a bundle whose logic reached ready, and only once per activation
ord: 10
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12b38-3e3e-7e9f-b873-d46325093e9c
sources:
  - kind: file
    ref: packages/execution-host/native/holder/src/holder.rs
  - kind: file
    ref: packages/execution-host/src/store/migrationChain.ts
---
- **Only proven.** The return is remembered at activation if the standing bundle's logic reached ready; otherwise there is nothing to return to, and the holder waits for a candidate as before. New logic reaching ready clears the return.
- **Only without exec.** A changed holder is a different image, and logic and holder always come from one build, so a return across exec would reopen another uncovered window.
- **Candidate before return.** On the longest pause the holder first takes a fresh `bundle.next`: the fix matters more than the rollback.
- **Once.** Having returned, the holder never returns again. A bundle it returned from, or whose holder did not take over after exec, is `rejected`: never taken without permission, and its PREPARE refused, so a repeated handover request for it is answered with a refusal, never a new activation. Taking it again on permission would activate it once per yield request: every new-build server offers it again on every start via road B, and terminals would stall to the threshold time after time. The list lives while the holder lives.
- **Store ahead.** The logic reconciles applied migrations against its own chain before `migrate` and answers `StoreAhead` when the store has moved past: drizzle would silently skip unfamiliar migrations, and the old logic would then run against someone else's schema.
