---
id: 01a151df-e920-73d7-9b09-09d66166d4dd
title: Terminal Claude Code and Codex receive the operator's footnotes as one prompt-submit hook answer
ord: 6
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/adapter/hookFormat.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/hooks/dispatch.ts
---
Terminal Claude Code and Codex receive the operator's footnotes as one answer to the prompt-submit hook. The operator's footnotes reach a native thread and Claude on ACP. A terminal CLI assembles the model request itself, and the single place where Tagma can add text beside the operator's words is the prompt-submit hook (`UserPromptSubmit`) that Tagma places on every CLI. Here that is Claude Code and Codex; besides them Cursor receives footnotes, whose answer to this hook was measured earlier, while other CLIs get no footnotes for now.

## What stands now

- A CLI is allowed a hook prompt-submit answer as model text only when its own row declares `hooks.promptContext` — measured: Claude Code, Codex and Cursor. Grok and OpenCode share Claude Code's hook file format but are unmeasured for this hook, so they stay silent; `promptSupported` reads the row, not the format.
- `guide_harness` has the `prompt` shape: one call answers orientation when owed plus footnotes.
- Hook calls to the server no longer have their own deadline: only the hook timeout the vendor declares limits them.

## Decision

- **First a probe.** A #research probe of the current Claude Code and Codex prompt-submit hook: whether the CLI accepts the answer text (`hookSpecificOutput.additionalContext` or stdout), where it places it relative to the operator's words, whether it keeps it in its history and transcript, whether it survives the vendor's compaction. `promptSupported` extends only to a measured CLI.
- **One call, one answer.** On the prompt-submit hook dispatch makes one `guide_harness` call of the `prompt` shape: the server answers the tail of footnotes as one text; `RunGuidance.hook` writes a `runtime-guidance` frame, an event repeat answers with the same text. Orientation stays on the session-start answer, which these CLIs also send after compaction and clear; the prompt answer carries no orientation. No second JSON on hook stdout.
- **Position.** Where the CLI puts text before the operator's words is the vendor's decision, and the probe records it; "after the words" holds only where the vendor allows.
- **Budget.** Footnotes come from the `OperatorNotes` memory owner. The hook waits for the server answer within its vendor timeout; a hook cut by the vendor releases the prompt with no footnote.
- **Codex measured** ([[45dee318]]): a `hookSpecificOutput.additionalContext` answer with `hookEventName: "UserPromptSubmit"` is placed by Codex 0.162.0 as a separate developer message after the operator's words and kept in the rollout. Cursor, whose prompt-submit answer was measured earlier, receives footnotes by the same road.
- **Claude Code measured** ([[86226056]]): the same `hookSpecificOutput.additionalContext` answer with `hookEventName: "UserPromptSubmit"` reaches the model of Claude Code 2.1.312, as a system message after the operator's words, kept in history across turns and dropped by compaction (the summary may or may not carry it).
- **Compaction** never keeps Codex hook text ([[45dee318]]) and keeps Claude Code's only if its summary does ([[86226056]]); both report it with `SessionStart` with `source: compact`, on which Tagma resets the said state and speaks orientation again; footnotes go on every prompt.
- **Footnote reading.** A thread's `read_operator_notes` answers `withheld` — why footnotes never reach the model — when its CLI takes no prompt-submit hook answer (the threads module's `NotesReach` port is filled by external-harnesses).
- **Event repeat.** The call evidence is the hook event's own hash, so the same event's repeat answers with the recorded text and writes no second frame.
- A CLI with no measured answer receives no footnotes, and the thread's `read_operator_notes` names it (`withheld`).

## What the executor proves

- A Claude Code and Codex research probe.
- A hook system test (`hooks/dispatch.test.ts`): `prompt`-shape `guide_harness` answers with one adapter-shaped document carrying a footnote — for Codex and Claude Code — the same event's repeat with the same text, the thread journal carrying one `runtime-guidance` frame per distinct prompt; a CLI with no measured answer (Devin, Grok, OpenCode) prints nothing and its `read_operator_notes` answers `withheld`.
