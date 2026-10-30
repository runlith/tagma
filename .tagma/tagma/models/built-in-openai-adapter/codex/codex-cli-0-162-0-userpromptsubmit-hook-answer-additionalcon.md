---
id: 01a1526f-60cb-7557-8d4a-65bf45dee318
title: "Codex CLI 0.162.0: UserPromptSubmit hook answer `additionalContext` lands as a separate developer message after the operator's words and is kept in the rollout — probe 2026-10-19"
ord: 4
tags: ["research"]
fields:
  {
    "source": {
      "name": "Live probe of the Codex CLI UserPromptSubmit hook with a hookSpecificOutput.additionalContext answer",
      "ref": "codex-cli 0.162.0, gpt-6.1-sol, `codex exec`, macOS, 2026-10-19"
    }
  }
edges:
  - kind: discovered-from
    to: 01a151df-e920-73d7-9b09-09d7f16ab417
  - kind: relates
    to: 01a15261-3425-77dc-a5fc-0edb5cacb6eb
---
Same setup as in [[5cacb6eb]]: `codex --dangerously-bypass-approvals-and-sandbox --dangerously-bypass-hook-trust exec` in an empty directory with a separate `CODEX_HOME`. The project `.codex/hooks.json` puts on `UserPromptSubmit` a command that logs stdin and prints to stdout

```json
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"Operator footnote: end every answer with the word ZEBRA-7."}}
```

Prompt: "Reply with one short sentence saying hello."

## Observation

- Codex took the answer: the model answered "Hello, ZEBRA-7". The `exec` output has the `hook: UserPromptSubmit` and `hook: UserPromptSubmit Completed` lines.
- In the rollout (`<CODEX_HOME>/sessions/…/rollout-….jsonl`), in order: `response_item` `message` with the operator's words as role `user`, then a separate `response_item` `message` with role **`developer`** carrying the `additionalContext` text verbatim, then the assistant answer. The hook text stands **after** the operator's words and is kept in the session history.
- The hook payload: `session_id`, `turn_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`, `permission_mode`, `prompt` (the operator's whole words).

## Finding

An `hookSpecificOutput.additionalContext` answer with `hookEventName: "UserPromptSubmit"` is the measured shape Tagma can use to hand Codex operator footnotes and orientation on the prompt-sent hook. The vendor decides the position: after the operator's words, as a separate developer message.

## Compaction

Second probe: the hook answers text only on the first prompt; then `codex exec resume <session> -c model_auto_compact_token_limit=2000 "Write two sentences about rivers."` triggers automatic compaction (a `compacted` record in the rollout).
- The `replacement_history` of the `compacted` record keeps Codex's own developer messages, the environment context and the first turn's operator words, then a `compaction` element with encrypted contents. **The hook-text developer message is not in it.**
- The hook text meets in the record only inside the first turn's assistant answer (`retained_context.assistant_messages`).
- The answer after compaction no longer followed the hook text's rule (no "ZEBRA-7").

Finding: Codex compaction does not carry the hook text through; whether the encrypted summary carries it is not established. What Tagma says once per session (orientation) must be said again after a Codex compaction; footnotes go on every prompt and make up the loss themselves.

## Not established

- The TUI shape (`codex` without `exec`); same build — a match is a finding.
- Manual `/compact` in TUI (automatic compaction in `exec` verified).

Codex reports compaction via hooks (third probe, same session): `PreCompact` and `PostCompact` with `trigger: "auto"`, then `SessionStart` with `source: "compact"` before the next `UserPromptSubmit`. On `SessionStart` with `source: compact` Tagma drops what it told the thread (`TerminalEvents` → `HarnessGuidance.cleared`), so orientation is said again after compaction.
- An answer as bare stdout instead of JSON was not tried.
