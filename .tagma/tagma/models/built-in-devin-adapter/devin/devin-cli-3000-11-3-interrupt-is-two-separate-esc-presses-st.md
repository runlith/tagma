---
id: 01a15f90-06be-7a2b-a17d-7a784776e930
title: "Devin CLI 3000.11.3: interrupt is two separate Esc presses, Stop arrives on stream interrupt and not on call interrupt, prompt never returns to the composer, mid-turn words wait for the end — probe of 2026-10-21"
ord: 8
tags: ["research"]
fields:
  {
    "source": {
      "name": "Live Devin CLI probe in PTY: one and two Esc on a call, in a stream, and before the first token, composer draft, Ctrl-U, mid-turn words, hooks and ATIF transcript",
      "ref": "Devin CLI 3000.11.3 (9c803229faa4), SWE-1.6 Slow; 2026-10-21; scratch 01a15f39…/probe (hooks.jsonl, .devin/hooks.v1.json)"
    }
  }
edges:
  - kind: relates
    to: 01a11d92-f128-7f29-9288-79ba04ba7dd7
  - kind: relates
    to: 01a15eeb-6b48-7ca8-9c93-24d8d0f5ca7e
---
Devin CLI 3000.11.3 (9c803229faa4), model SWE-1.6 Slow (free plan), `--permission-mode dangerous`, 2026-10-21, one host (macOS). CLI in a 120×40 PTY raised through the Tagma terminal. Input — writes into the PTY: words by paste, Enter and keys as separate writes. Screen — a host text frame. Hooks — project `.devin/hooks.v1.json` with a logger (UserPromptSubmit, PreToolUse, PostToolUse, Stop, Notification, SessionStart). Transcript — `~/.local/share/devin/cli/transcripts/<session>.json`. Long call — `node -e "setTimeout(…)"`. Logs stayed in the scratch of thread 01a15f39. One sample per case.

## Condition that changes the probe

The hooks file is an object with events at the top level. The `{"hooks": {…}}` wrapper is rejected whole: Devin log "unknown variant `hooks`, expected one of `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `PostCompaction`, `PreCompact`, `PostCompact`, `SessionStart`, `SessionEnd`, `PermissionRequest`, `Notification`, `SubagentStop`". This list holds `Notification`, which was absent on 2026-10-08 ([[04ba7dd7]]).

## Interrupt key

- **Two Esc as separate consecutive writes** interrupt both the text stream and the call ("✱ Canceled. What should Devin do?", on a call "Canceled due to user interrupt", the process goes "Running in background"). The turn is interrupted even with a draft in the composer: the draft stays.
- **One Esc** only arms the interrupt ("esc again to interrupt"). After ~2–3 s the hint returns to "esc twice to interrupt", and the next lone Esc only arms again.
- **Two Esc in one write** (`\x1b\x1b`) acted as one: "esc again to interrupt". Two separate writes are needed.

## What the key does to the prompt and the draft

- Mid-stream and 0.3 s after Enter the composer is empty after the interrupt, with the "Ask Devin to build features, fix bugs, or work on your code" placeholder. The prompt does not return to the field.
- A draft typed during the turn survives two Esc.
- Ctrl-U erases the current line's text. On an empty line of a multi-line draft it does nothing: lines are not joined.

## Input mid-turn

A word with Enter during a call queued up ("── 1 queued ── ↑ edit · ↵ send now", in the composer "Press Enter to send queued messages now"). It left as a separate turn after the first one ended: screen "DONE", then the word's prompt and the answer "DONE BANANA".

## Ready confirmation

- **Stop** on a **stream** interrupt arrived ~1 s after the keys, with the turn's `prompt_id` and a partial `last_assistant_message`. On a **call** interrupt no Stop arrived. On 2026-10-08 Stop arrived in neither case ([[04ba7dd7]]).
- The transcript had no mark right after the interrupt: the last step was the agent's partial answer. The `[Response interrupted by user]` step of 2026-10-08 was not observed.
- Screen: the composer placeholder without "esc twice/again to interrupt" and "Guide Devin while it works" — already on the first frame after the keys (≤ 1 s). With a draft in the composer the placeholder is hidden.

## Composer with text

Second probe the same day, CLI already updated to 3000.11.92:
- The composer stands between two `────` rules. The upper rule carries the mode mark (`… (bypass permissions on) ─`). Text is a `❭ <text>` line, continuations indented by two spaces.
- An empty composer shows "Ask Devin to build features, fix bugs, or work on your code" while idle and "Guide Devin while it works" during a turn under `Running tools · 6s (esc twice to interrupt)`.
- A long paste folds to `[Pasted text #1 +26 lines]` in the composer line.
- Ctrl-C while idle clears a non-empty composer.

## Not established

- Ctrl-C.
- Whether `Notification` arrives, and with what.
- Whether the `[Response interrupted by user]` step appears in the transcript later.
