---
id: 01a113ee-1dc0-7895-8b72-9ce9f3949b43
title: "Thread recap and title on ACP ask the Claude session itself: a `source: 'session'` copy goes to the runner as `_tagma/aside` and is answered by a Claude Code side question"
ord: 10
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/asides.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/copies.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/methods/aside.ts
  - kind: file
    ref: apps/tagma/server/src/threads/harness/turns.ts
---
On a native thread the recap and title copy is a request Tagma itself sent to the model. On an ACP thread the request is made by Claude Code inside the runner, so Tagma has no copy. But Claude Code holds the main thread's last request parameters, and its `side_question` (`/btw`) forks over them: one turn, tools forbidden, nothing written into the session transcript, no cache append. In cost it is a prefix read from cache — the same as a native aside.

So the driver places a `source: 'session'` copy on every measured model request of the turn (`usage_update` with `_meta['tagma/measured']`), starting with the first, and once more at the turn's end under any outcome — as native places a copy on every request: its `ask` sends the runner `_tagma/aside`, and the runner calls `askSideQuestion`. A live query's side question answers even mid-turn ([[77722519]]), so "Generate title" during the first turn goes through this copy. The copy lands in the same `ThreadAsides`, and recap and "Generate title" continue the native way. The aside answer is live: the `_tagma/aside` declaration (`methods/aside.ts`) only reads the outcome, while the driver step after recording it puts it into the waiters' memory (`AsideAnswers`), not into the protocol row; the asker waits on it with the shared connection wait; a session ending before the answer answers with a refusal, not an endless wait. Such a copy skips the model, rung, and account reconciliation: the session always answers with its current state, and a CLI provider has no account in Tagma. The model in the recap basis is the pick the session served.

The copy's deadline is the warmth of the thread's latest context reading, which the driver records on every model request ([[c7d3d8a2|read on every request]]): the request's `sentAt` plus the cache deadline Claude Code actually recorded (1 hour for a subscriber, 5 minutes otherwise). The copy is placed only when that reading is of this same turn, a session of the same provider, not stale, and still warm: a turn that failed before the first request gets no copy with the previous turn's deadline; with no measured deadline the prefix does not count as warm, and there is no copy. So automatic recap is recorded before the end of the same deadline as on a native Anthropic thread. The copy lives no longer than the runner process answering it: the process end (idle, crash, release, transport change) goes one road, `ProtocolProcess.drive`, and it removes the session copy (`ProtocolAsides.exited`), so a manual recap refuses `not-warm` and the title asks a fresh excerpt — not a processless aside refusal.

`askSideQuestion` exists in the SDK only in code — not in the types even in 0.3.292 — and spend is read from the experimental `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET` as a cumulative difference. Both calls, like `cancelAsyncMessage` (recalling unserved words on cancel and on `_tagma/withdraw`), live in the one runner file `runner/sdk.ts` of `@runlith/adapter-anthropic` — the adapter of the `Channel` contract over `Query` — each with its own narrow declared type there. With no `askSideQuestion` or `cancelAsyncMessage` the answer is `methodNotFound`, not silent success. With no spend method, the aside answers text with no `usage`: spend is optional for the driver and means "unmeasured", not zero; a spend answer in a form the runner does not read is an `internal` refusal, not zero spend. `contract.test.ts` on a fake SDK covers all these cases.

Measurement 2026-10-07 (SDK 0.3.284 and 0.3.292, CLI 2.1.292, Sonnet, prefix about 11.6K tokens, one run): in the live process the side question read 10,919 tokens from cache, after resume in a new process 11,590; the transcript message count did not change.
