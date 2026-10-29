---
id: 01a1889c-9ae7-7f58-87c8-67f686226056
title: "Claude Code 2.1.312: UserPromptSubmit hook answer `additionalContext` lands as a system message after the operator's words and stays in history until compaction — probe 2026-10-29"
ord: 2
tags: ["research"]
fields:
  {
    "source": {
      "name": "Live probe of the Claude Code UserPromptSubmit hook with a hookSpecificOutput.additionalContext answer",
      "ref": "claude 2.1.312, claude-haiku-5-5, `claude -p`, macOS, 2026-10-29"
    }
  }
edges:
  - kind: discovered-from
    to: 01a151df-e920-73d7-9b09-09d7f16ab417
  - kind: relates
    to: 01a1526f-60cb-7557-8d4a-65bf45dee318
---
Same method as [[45dee318]]: a project `.claude/settings.json` puts on `UserPromptSubmit` a command that logs stdin and prints to stdout

```json
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"Operator footnote: end every answer with the word ZEBRA-7."}}
```

Run: `claude -p --model haiku --dangerously-skip-permissions --session-id <uuid> "Reply with one short sentence saying hello."` in an empty directory; the session transcript (`~/.claude/projects/<dir>/<session>.jsonl`) read afterwards.

## Observation

- Claude Code took the answer: the model answered "Hello, nice to meet you. ZEBRA-7".
- The hook payload (stdin): `session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`, `hook_event_name`, `prompt` (the operator's whole words).
- Transcript: an `attachment` of type `hook_additional_context` (`content: [text]`, `hookEvent: "UserPromptSubmit"`) follows the `user` record with the operator's words.
- In the model request the text is not part of the operator's user message (whose blocks are the instruction reminders, the account reminder and the words): it rides as a mid-conversation system-role message, after the operator's words, as `UserPromptSubmit hook additional context: <text>`.
- A second prompt in the same session, with the hook silent: asked about a footnote, the model quoted the first prompt's text. The hook text stays in the session history across turns.

## Finding

An `hookSpecificOutput.additionalContext` answer with `hookEventName: "UserPromptSubmit"` reaches Claude Code 2.1.312's model, placed after the operator's words and kept in history. It is the same envelope as Codex; the position is the vendor's.

## Compaction

`/compact` (via `-p --resume`) on that session: afterwards the hook message itself is gone from the context; the model found the footnote only inside the compaction summary and said so ("I can't see the hook message itself in this context"). Whether the summary keeps it is the summariser's choice, so it is not guaranteed. What Tagma says once per session (orientation) must be said again after compaction — Tagma already resets the said state on `SessionStart` with `source: compact` — and footnotes go on every prompt.

## Not established

- The TUI shape (`claude` interactive) on the same build; `claude -p` was read.
- That Claude Code sends `SessionStart` with `source: compact` on this build (the vendor documents it; not observed in this probe).
- An answer as bare stdout instead of JSON; Grok and OpenCode, whose hook formats match Claude Code's file shape but whose CLIs were not probed for this hook.
