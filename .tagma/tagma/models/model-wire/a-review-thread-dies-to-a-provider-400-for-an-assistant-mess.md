---
id: 01a0c981-2912-7e74-ad28-6e6141b68ee4
title: A review thread dies to a provider 400 for an assistant message with no content and no tool_calls, and every retry of its call fails identically
ord: 50
tags: ["reflection"]
fields:
  {
    "actual": "Three runs of one review thread died before the model ever executed, each with the same provider rejection: `RequestExecutor.execute: Provider request failed with HTTP 400: {\"error\":{...,\"message\":\"Upstream request failed: [invalid_request_error] Invalid assistant message: content or tool_calls must be set\"}}`, marked `not retryable` and `model execution never started`. The first failure was a (length) failure, the next two the identical HTTP 400. The run guidance for those reports said to leave the thread's work where it stopped and not to re-task or replace it, which conflicted with the orchestration duty: the review it was assigned never ran, and no reviewer verdict exists for the change it was reading.",
    "command": "spawn_agent(agentId=code, name=review-tokenizer, model=deepseek-v4.1-flash, provider=opencode-go, reasoning=max) with a read-only review brief over /opt/workspaces/runlith",
    "expected": "The spawned thread reads the named commit and the owners it touches, and returns a findings report: one line per finding with file and line, plus a verdict of correct as landed / correct with notes / must change — executing nothing, per the repo's own Validation law that binds a reviewer to read."
  }
---
Filed from project `runlith`.

Threads: the spawned reviewer `review-tokenizer`, thread `01a0c979-5cf2-794a-b0b-e7f8969a120f`, runs `01a0c97d-821a-4a5b-8a19-8e6d8b2ee045` (length), `01a0c97f-2e9f-78cd-b0cb-d2726abbe30f` and `01a0c97f-4784-7bee-abaf-a08f2efc6e09` (identical HTTP 400, not retryable). The brief asked for a read-only review of commit `64e7b3fdcf` in `packages/source-comments/src/languages/typescript.ts`.

What the failure record shows: the provider rejected the REQUEST, not the answer — `model execution never started` on the last two. A request rejected for an assistant message carrying neither content nor tool_calls is a defect in the conversation the thread sent, so every retry of that thread's call will fail identically, and the recovery note's "the same call will fail again" is satisfied by the diagnostics. This is why a fresh thread on the same provider and model is the recovery taken, rather than continuing the broken history or silently changing model.

The instrument cost: three provider calls consumed (one a length failure, two rejected requests) for zero reviewer output, and the operator's orchestration lost a verdict it was promised. No workaround was built; the change under review remains unreviewed until the fresh thread reports, and that fact is stated to the operator rather than papered over.