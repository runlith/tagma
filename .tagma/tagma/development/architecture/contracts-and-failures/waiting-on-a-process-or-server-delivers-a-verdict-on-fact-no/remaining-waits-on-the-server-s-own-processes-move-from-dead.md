---
id: 01a14171-3f5a-796f-8ce3-865c9595245b
title: Remaining waits on the server's own processes move from deadline verdicts to facts
ord: 1
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a1415a-db80-7f6b-b559-38f85c98bd35
---
After start, restart and refresh moved to facts ([[5c98bd35]], [[29207044]], [[b2a15989]]), the server still holds waits on its own processes that deliver verdicts on deadline. The law [[7609a86c]] requires fact. The list is cut by `rg` on `PATIENCE|timeoutOrElse|Effect.timeout|AbortSignal.timeout|did not answer within` in `apps/tagma/server/src` 2026-10-15, with no tests; each place is read first — a deadline may turn out to be poll frequency, not a verdict.

**Own processes and files — under the law:**
- `release-channel/install.ts` — `LOCK_PATIENCE_MS` 10 min on the install lock a live process holds.
- `threads/ending.ts` — `ENDING_PATIENCE`.
- `change-record/record/commandRows.ts` — `PATIENCE` (1 s → 30 s, 180 s total).
- `executions/terminals/custody.ts` — `timeoutOrElse`.
- `checkout-files/worker/client.ts` — the diff worker's `ANSWER_CEILING_MS`.
- `external-harnesses/hooks/dispatch.ts` (10 s), `hooks/delivery.ts`, `sessions/lifecycleDriver.ts` (handshake), `birth/installed.ts` (`--version`), `accounts/cli.ts`, `protocol/links.ts` (`WaitExpired`), `metadata/harnessMetadata.ts`.
- `landing/merge/modes.ts`, `landing/land/publish.ts` — the git signer past `callCap`.
- `sandbox/engine/docker/channel.ts` (15 s), `image.ts`, `exec.ts`.
- `workspace/checkouts/comparison.ts`, `speech/listening/sending.ts`, `composition/cut/restart.ts` (`PATIENCE_MS`, the `tagma:try` tool).

**Outside services — a deadline is lawful, check only the refusal wording:** `push/webpush/send.ts`, `remote/tailscale/warmup.ts`, `release-channel/delivery.ts` (plain loading), `installation/cut/runtime.ts` (loading), `threads/naming/generate.ts` and `threads/recap/schedule.ts` (the model answer).

Done when every place in the first list awaits a fact or, if its owner publishes no fact, publishes one; the second list is checked that the refusal names the outside cause, not "didn't start".
