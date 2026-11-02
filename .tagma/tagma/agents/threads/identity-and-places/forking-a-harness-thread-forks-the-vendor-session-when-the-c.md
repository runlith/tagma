---
id: 01a16efb-4661-717d-8fa5-b19d3257c9e8
title: Forking a harness thread forks the vendor session when the child seats on the same harness — including spawn with `forkFrom` whose child is not born a `harness` row
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/history.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/opening.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/row.ts
  - kind: file
    ref: apps/tagma/server/src/threads/harness/births.ts
---
Spawn hands the child the agent type id (`tagma`), not `harness`, so birth cannot recognize a hosted branch by the child's `agentId`: such a child seats via `servedSeat`, and only `inheritFacet` makes it a harness row. `EngineBirths.record` forks the vendor session whenever the child is served by the same harness holding the source session: the child's protocol row gets `fork`, and the driver opens it as `_tagma/fork` (resume + forkSession in Claude Code), while seating stays the child's own — its agent, model and switches. A fork keeping the source's identity — same agent, profile, project, provider, model and reasoning — inherits the source's account choice and switches, since its requests must carry the source's cache identity: a source following the provider default leaves the child following it, an explicit account stays explicit. A child given another identity keeps its own choice. The account holding the source session identifies the conversation to copy; it never becomes a new account choice. An ACP fork origin records its source account, and opening forks only when the launched process uses that account; a different or unknown origin account starts a session from the journal. A terminal origin keeps the source account while alignment carries or seeds the conversation under the child's choice. A child explicitly given another account, and a child on another harness or a native provider, starts from the journal instead of borrowing the source sign-in.

The vendor fork opens lazily, at the child's first turn, so the origin pins the source at birth: a whole copy records `through`, the latest `tagma/turn.last` the runner reported (`vendor_turn.last`) — for a turn, a failed turn (in its fault data) or an idle compaction, whose answer names the record ending the rewritten transcript so the fork carries the compacted prefix — and the runner keeps the source only through that record; an act that reported none leaves the earlier tail standing, and a source with no reported tail leaves the copy unpinned — otherwise turns the source ran between the birth and the child's first turn would enter the child's vendor session but not its journal. A whole fork of a source whose turn is going is a cut before that turn, pinned the same way at the tail the turns before it left. The origin stands until the child's first turn reaches the vendor (`tagma/opened`), since a vendor writes a lazy fork only then: a process started before that forks again from the same origin, and a fork of such a child composes against its origin — the source session, cut and account — rather than the child's still-empty session. The opening also names the source thread's vendor storage root when the profile keeps storage per thread, since a vendor whose session lives there cannot reach it from the child's own storage. An agent that answers the fork `notFound` (source session, record or checkpoint gone) gets no halt: the origin is dropped and the child opens from the journal; any other refusal fails the opening as before.

Without a fork the driver opened `session/new`, and the runner assembled the session from Tagma's journal (`transcript.ts`). Such a session diverges from what the source actually sent: the run's context stands as separate user messages, there is no reasoning, and blocks Claude Code inserts itself are missing where they were. The fork's first request matched the source only in tools and system prompt, and rewrote the whole loaded history in the prompt cache: measured 2026-10-24 (claude 2.1.306, haiku) — cacheRead 32341 of 81636 versus ~81.1k recorded by the source.

A hosted branch, including a spawn child served by a harness, takes no background rollout export after commit ([[8fdaec3a]]): harness-thread transitions open the journal outside the lane.
