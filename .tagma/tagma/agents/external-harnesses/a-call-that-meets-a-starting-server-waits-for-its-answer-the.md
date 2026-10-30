---
id: 01a14274-9f8b-7125-818c-5dddc226e611
title: "A call that meets a starting server waits for its answer: the client door honors retry-after, the runner survives restarts on every hosted operation, the queue does not hide the phase"
ord: 72
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14263-991f-706f-a326-41e098fce759",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/workLine.ts
  - kind: file
    ref: apps/tagma/server/src/cli/door.ts
  - kind: file
    ref: packages/adapter-anthropic/src/runner/bridge.ts
  - kind: file
    ref: packages/adapter-anthropic/src/runner/door.ts
---
A Claude thread on `acp` survived a server restart at 03:44 on 16.10 ([[01a1413f-28ad-75a4-b37a-dbf1e18a13cc|thread]]). Claude Code called `write` at 03:44:02, `call_hosted_tool` reached the starting server and got 503 `server-starting` with `retry-after: 1`. The client door `cli/door.ts` (`undeclaredAnswer`) turns this refusal's body into a bare `Error`, the runner (`runner/claude/door.ts`) marks it failed, and `bridge.ts` retries a call only on server silence and `run-not-held`. The model received a false error and retried the record with a new call. The first call left a `Handed` mark with `failed`, and its record stood `queued` for 2 min 48 s until the turn ended. The sidebar showed "1 queued" all those minutes instead of the phase: `workLine.ts` hides the phase when a call is queued with no turn running.

What to do:
- **Client door** (`apps/tagma/server/src/cli/door.ts`): a 5xx that the server declared a refusal (`tagma-outcome: refusal`) stays a refusal with its body, not an `Error`. A refusal with `retry-after` is a promise to answer: `ask` waits the named period and asks again until the answer changes. Then every client survives a server start: CLIs, the `mcp-serve` of terminal CLIs, and the runner.
- **Runner** (`runner/claude/door.ts`, `bridge.ts`): the runner process lives as long as its run holds the server, so every hosted operation waits while the server is unreachable or answers `run-not-held`. The wait lives in one place — `ServerDoor`; `Bridge` has no retry of its own.
- **List row** (`apps/tagma/app/src/lib/features/threads/workLine.ts`): a queued call does not displace the model phase; while a phase runs, the row shows the phase plus `N queued`.
- The Claude runner note ([[d0810682]]) is corrected by the same change.

Proof: a client-door test on a starting server (a call answered after readiness, not refused), a `ServerDoor` test (silence and `run-not-held` are waited out, a server failure is not), a list-row test (phase with queue), typecheck of the affected packages.
