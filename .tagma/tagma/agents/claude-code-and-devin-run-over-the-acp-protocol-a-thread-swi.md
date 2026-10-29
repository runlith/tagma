---
id: 01a14b6d-b251-7de8-8df7-718937136e0e
title: Claude Code and Devin run over the ACP protocol; a thread switches between terminal and ACP
ord: 25
---
Claude Code and Devin can run as threads not in a terminal but over the official Agent Client Protocol from a held process: then the turn, questions, law, and report go over the protocol, and the thread can do what a terminal CLI cannot.

**Claude Code.** Over ACP Claude Code runs the Tagma agent: `tagma harness-run claude` (launches the server, never called by hand) drives Claude Code through the Agent SDK with the native agent's prompt and tools hosted by the thread, and with the thread's grant on every call; the web is Claude's own. A thread lands on Claude Code the same way when the operator or agent picks the `claude-code` provider model (login is the CLI login of Claude): the thread moves to that road keeping the journal, and returns with a native model. Capabilities: words mid-turn (Enter — steer, Tab — follow-up, word withdrawal), branching and rollback through the vendor session, compaction with its own model in the vendor session, resuming what was cut, images, law on every call, accounting of reads, writes, and authorship.

**Devin.** `devin acp` runs Devin's own agent; its models go only in a `harness:devin` thread. Words wait for the turn's end, no compaction; the law judges the calls Devin asks permission for.

**How to pick the transport.** The `threads.harnessTransport` setting is the road a new thread of each CLI is born on (`terminal` or `acp`; a CLI without an ACP profile is born in the terminal). `set_thread_transport` moves a thread stopped between turns: the operator or the thread's parent (outside its own subtree — on the operator's word); a process resting between turns ends first. The next launch continues the same vendor session where the vendor shares it between roads, otherwise opens a new one with the thread's recap; words passed without confirmation stay that way.

**Limits and refusals.** A running turn — `thread-running`; a CLI without a profile — `transport-unavailable`; a CLI-thread profile (its own directory, plain, permission mode) applies only to the terminal — `profile-transport`. The vendor CLI login is needed (for Claude — `claude auth login`).

Code: apps/tagma/server/src/external-harnesses/vendors/claude/acp.ts#claudeAcp, apps/tagma/server/src/external-harnesses/vendors/devin/acp.ts, apps/tagma/server/src/external-harnesses/birth/seat.ts#acpCapabilities, apps/tagma/server/src/external-harnesses/birth/transport.ts, apps/tagma/server/src/external-harnesses/cli/harnessRun.ts, apps/tagma/server/src/external-harnesses/contract/wire/operations.ts#HARNESS_OPERATIONS, apps/tagma/server/src/external-harnesses/settings.ts#harnessTransport, apps/tagma/server/src/threads/harness/registry.ts
