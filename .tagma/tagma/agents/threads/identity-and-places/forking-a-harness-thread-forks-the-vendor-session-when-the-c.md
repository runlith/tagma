---
id: 01a16efb-4661-717d-8fa5-b19d3257c9e8
title: Forking a harness thread forks the vendor session when the child seats on the same harness — including spawn with `forkFrom` whose child is not born a `harness` row
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/harness/births.ts
---
Spawn hands the child the agent type id (`tagma`), not `harness`, so birth cannot recognize a hosted branch by the child's `agentId`: such a child seats via `servedSeat`, and only `inheritFacet` makes it a harness row. `EngineBirths.record` forks the vendor session whenever the child is served by the same harness holding the source session: the child's protocol row gets `fork`, and the driver opens it as `_tagma/fork` (resume + forkSession in Claude Code), while seating stays the child's own — its agent, model and switches. The fork takes the account the source session runs under: the vendor session lives in that account's storage (`CLAUDE_CONFIG_DIR`), and the default account may have changed since the source started. This applies while Tagma can name that account for launch (`HarnessAccounts.launchable`: a catalog row, an api-key key, or the default CLI login; no CLI is launched for it). An expired api-key key cannot be named, as in launch itself. Otherwise the child takes the source row's selection. Birth passes that account into `TransportHistory.fork`, and the adapter decides the vendor-session copy. ACP forks only when the source session runs under the same account; otherwise the child is assembled from the journal. The terminal records origin with the source account, and its reconciliation yields a new session with a Tagma record and reason `account`. There is no launch refusal. Birth seats a terminal child the same way: only it decides its account. A child explicitly given another account, and a child on another harness or a native provider, does not fork the session and is assembled from the journal.

Without a fork the driver opened `session/new`, and the runner assembled the session from Tagma's journal (`transcript.ts`). Such a session diverges from what the source actually sent: the run's context stands as separate user messages, there is no reasoning, and blocks Claude Code inserts itself are missing where they were. The fork's first request matched the source only in tools and system prompt, and rewrote the whole loaded history in the prompt cache: measured 2026-10-24 (claude 2.1.306, haiku) — cacheRead 32341 of 81636 versus ~81.1k recorded by the source.

A hosted branch, including a spawn child served by a harness, takes no background rollout export after commit ([[8fdaec3a]]): harness-thread transitions open the journal outside the lane.
