---
id: 01a151df-e920-73d7-9b09-09d7f16ab417
title: Probing the Claude Code and Codex prompt-submit hook, and a footnote-carrying prompt shape of guide_harness
ord: 1
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d66166d4dd
---
Builds [[6166d4dd]]. First the Claude Code probe and its #research, then the `prompt` shape at `guide_harness` and extending `promptSupported` to Claude Code; Codex follows the same road after its own probe.

Done when the spec's hook system test passes for each measured CLI.

**Done for Codex (`e9f0d39dca`).** Codex 0.162.0 probe — [[45dee318]]. `guide_harness` gained the `prompt` shape: the server answers one `RunGuidance.hook` with footnotes (`RunGuidance.notes` → `OperatorNotes`) and orientation when owed by key; evidence is the hook event hash, a repeat of the same event answers with the same text and no second frame. `promptSupported` — Cursor and Codex; the Codex answer is `hookSpecificOutput` with `hookEventName: "UserPromptSubmit"`. Cursor now receives footnotes too. Test `hookReport.stest` "a Codex prompt is answered in one Codex document…": orientation once, a footnote every time, an event repeat with the same text, two `runtime-guidance` frames over two turns; Cursor orientation tests rewritten for footnotes. Review: P2 "an event repeat answered with different text" fixed (evidence from the event); P2 "the first-prompt answer may exceed `PROMPT_CONTEXT_CHARS` by the footnote size" — footnotes first, the limit not recalculated for the resulting document; P3 "`read_operator_notes` never names a CLI with no measured answer" — not done.

**Brought through (`ca545b1bfa`).** The answer limit counts on the resulting document: the server builds orientation in `prompt`-shape `guide_harness` (`orient: {projectId, cwd}`) and fits it with `Orientation.firstPrompt` measured with footnotes; the "a Codex prompt…" test holds the answer within `PROMPT_CONTEXT_CHARS` with orientation at the very limit (25 rules). A graph refusal at orientation is a declared `orientation-unavailable`, and the hook asks again without it, so footnotes still arrive. An evidence repeat answers with the recorded text before orientation builds. `read_operator_notes` answers `withheld` for a thread whose CLI takes no prompt-hook answer (the `NotesReach` port of the threads module fills it from external-harnesses); test on Claude Code (line) and Codex (null). Codex compaction checked ([[45dee318]]): the hook text never survives it, but Codex sends `SessionStart` with `source: compact`, and Tagma speaks the orientation again. Second-round review: both P2s (undeclared graph refusals, the repeat depended on the graph) fixed; the `orientation-unavailable` path uncovered by test.

**Open.** The Claude Code probe — after its subscription limit lifts (22:00 UTC 2026-10-19), as a separate task; `promptSupported` not extended to Claude Code.
