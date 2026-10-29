---
id: 01a0c4f7-921c-7b2c-bf4e-4097d689ef45
title: "D-3: the CLI started on Tagma's own plumbing text — one predicate, one neighbour to keep, start 70fe581ba"
ord: 1
---
D-3: a harness CLI opened from a Tagma thread starts on Tagma's own per-turn plumbing — the deferred-tools notice of the orientation — instead of the operator's words; the measured run burnt 109 833 tokens of Claude Code answering text nobody wrote.

- **Start commit.** `70fe581ba` — the parent of the repair. The brief supplies the symptom and the argv the CLI was actually started with.
- **Reference repair, withheld from workers.** `9f8f730dc`, the `turnText` half of it: the function took the LAST message with `role: 'user'`, and the per-turn orientation, a guidance frame, an agent envelope and a compaction summary all enter wearing that role. The repair keeps a user message only when it carries no runtime origin or is marked reader input — `agentOriginOf(message) === undefined || agentReaderInput(message) !== undefined`. The same commit's other half — the wordless `begin` that lets a `+`-born thread open a run at all — is a separate bug and is not this hunt.
- **Why it is small but sharp.** One file, one predicate; what it measures is whether the contestant learns the message-origin vocabulary (`AGENT_MESSAGE_ORIGINS`, `agentReaderInput`) instead of pattern-matching the notice text. The session's own first fix was too strict — reader input alone — and broke a standing case where a peer's task rides an envelope; the second fix is the reference. Breaking a neighbour while fixing the symptom is the scored failure.
- **Oracle: MISSING.** No test at HEAD proves that a runtime-origin `role: user` message is never the argv. Before a launch, write one in `harnessRun.itest.ts` beside "the row's argv carries the turn": messages `[orientation-origin user, reader user, guidance-origin user]` → the fixture's argv file holds the reader's words alone; and a second with an envelope-origin task → its text IS the argv. Without both, the too-strict fix passes.
- **Judged.** Repair at the producer (the predicate) versus at the symptom (stripping the notice); the neighbour case; whether the contestant read the origin vocabulary or invented one.
