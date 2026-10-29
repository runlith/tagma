---
id: 01a15ff4-4a36-7b8e-b7e8-d95565011336
title: "The \"Esc and Enter\" conformance set judges a transport from the agent's side: each rig answers one port, the vendor's extra turn counts as the difference from the core's turns"
ord: 1
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a15eeb-6b48-7ca8-9c93-24db7deebf81
sources:
  - kind: file
    ref: packages/agent/src/thread/conformance/transportStops.ts
  - kind: file
    ref: packages/agent/src/thread/conformance/transportWords.ts
---
The "Esc and Enter" conformance set judges a transport from the agent's side: each rig answers one port, and the vendor's extra turn counts as the difference from the core's turns.

The set knows no transport: each rig — native over `compactionWorld`, ACP over `protocolRig` with a scripted agent and with the Claude runner over `claudeCode.ts`, terminal over a fake CLI in a PTY — brings its own thread into state and answers the same questions of the port. A new transport therefore passes the same set by writing only a rig.

- **The agent is its own accounting, not Tagma's journal.** The rig reads `agentTurns`, `interrupts`, and `heard` from the agent's side: frames the scripted agent received, the fake Claude Code's events, the fake CLI's bytes and hooks; in native the agent is the core loop itself, and its turns are runs while words are the last model request. A check "the agent did not continue the turn" or "the word arrived once" built on Tagma's journal would have matched what Tagma believes and missed the 2026-10-21 incident, where Tagma read the turn as cancelled while Claude Code executed the word.
- **The vendor's extra turn counts as the difference.** After a stop the core lawfully opens a next turn only in two states — a mid-turn word without an echo and compaction on a step — and no more than one; in all others, none. The agent's turns after the stop must number exactly the core runs (`origin: core`) opened after the stopped one: an observed run started by the vendor does not replenish that count, and continuing the stopped turn cannot pass as a lawful next one. A vendor turn interrupted at the start before a model request does not count as an agent turn.
- **A word without an echo is not lost.** It either opens exactly one next turn or stands read behind the stopped turn — as with Claude Code, which reads a word from stdin after interrupt and keeps it in the session history.
- **After the receipt only what the agent said is judged.** The turn journal compares without records of operator-word fates (`signal` addressed to `reader`) and without the question outcome: a `question` record keeps only what the agent asked, and its closing by Tagma's stop may arrive after the receipt. These are selectors by record kind, not a list of texts; a new question after the receipt is a new record, and it turns the case red. Messages, calls, stream tail, and `_tagma/said` after the receipt turn the case red.
- **Verdict on the fact.** The set awaits the turn end, thread rest, and a second interruption with no deadlines of its own; the stop-to-end time comes from the turn line's `finishedAt` and is only printed in a table.
- **Thread rest** on ACP rigs means no going turn, no `queued` words, and an idle agent.
- **An unreachable state** the rig declares from the transport's declared capabilities (native has no vendor or its session; the terminal declares `compaction: 'none'`), not as a skipped test.
