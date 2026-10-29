---
id: 01a151df-e920-73d7-9b09-09d091976ebe
title: "Agent layer: what remains after the single-core and transports refactor"
ord: 9
tags: ["spec"]
fields:
  {
    "status": "open"
  }
---
The 7–8 October refactor of the agent part is built: one run core, questions and approvals in one core, native, ACP and terminal behind the transport contract. This spec holds only what the code at `2774db6ebe` (2026-10-19) still does not do. Each remainder is a task under it; unstarted work needing design is a child spec. The spec closes when its children close; operator check is not a closing condition.

## Order

Claude Code goes first among foreign CLIs — both on ACP (runner over the Agent SDK) and in the terminal — Codex second in the TUI. Devin, Cursor, Grok, Gemini and other vendors are not being done now, and their remainders are not here.

1. First what breaks Claude Code today: the terminal flow is born with an empty envelope as its first prompt ([[093e94ab]]), its interrupted turn does not end the run ([[03dc0c6a]]), and the row does not know its model ([[6229df6b]]); [[35d5a24c]] — the ACP flow does not find the CLI outside PATH, [[22aacfd9]] — terminal Claude Code search does not bring the law, [[053c04be]] — automatic Claude compaction on ACP does not take its own model.
2. [[cc3ca850]] closes the hole through which an agent changes another project before seeing its law.
3. For Codex in the TUI [[76cf9bbf]] goes first, then the footnotes on [[6166d4dd]] — Claude Code there first too, then Codex.
4. The remaining tasks are independent and run in parallel: the approval route, the run core (one context per run, step cost without compaction, build without late-filled ports, rules and modes by registration, closing the withdrawn contributor's question, closed wire feed schema) and transports (one capabilities declaration, lazy terminal restore, rollout form steps, ACP driver beat, CLI-tool approvals at the adapter).
5. [[d7c40fd9]] is the largest work; nothing here depends on it and it holds nothing.

## What is not included

- Accepted by the operator when closing the earlier specs: incomplete transport-parity matrix, a common thread-rest suite without the SQLite runner, leftover own result recording in `ThreadHosting`, fork and rewind at Devin.
- Mode on a separate thread and contributor id spaces: except the three built-ins, no mode is registered, and mode plugins do not contribute, so a mechanism with no consumer is not built — it arrives with the first contributing mode.
- An envelope from a sender outside the thread — a plugin or a shell — with an addressable answer: it has no consumer, and a plugin already acts on behalf of the thread that invoked it. If needed, that is a separate spec.
