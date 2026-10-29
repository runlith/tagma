---
id: 01a15f62-00cf-7dc0-b9a7-75b7c00d2207
title: "Claude Code 2.1.306: Esc interrupts the turn with no Stop and leaves the process; before the first token the prompt returns to the composer, Ctrl-C clears a non-empty composer; mid-turn words join the running turn — probe 2026-10-21"
ord: 7
tags: ["research"]
fields:
  {
    "source": {
      "name": "Live Claude Code probe in PTY: Esc on Bash, before the first token and when idle, composer clearing, mid-turn words, work and idle screen",
      "ref": "Claude Code 2.1.306, claude-haiku-5-5; 2026-10-21; scratch 01a15f39…/probe (hooks.jsonl, transcript ~/.claude/projects)"
    }
  }
edges:
  - kind: relates
    to: 01a11d92-f111-703b-a5d3-e97744dbe4a8
  - kind: relates
    to: 01a15eeb-6b48-7ca8-9c93-24d8d0f5ca7e
---
Claude Code 2.1.306, model `claude-haiku-5-5`, `--dangerously-skip-permissions`, 2026-10-21, one host (macOS). The CLI in a 120×40 PTY raised through the Tagma terminal; input is PTY records (words by paste, Enter and Esc as separate records), the screen is the host text frame. Hooks are the own logger in `--settings` (UserPromptSubmit, PreToolUse, PostToolUse, Stop, Notification); `CLAUDE*` and `AI_AGENT` variables removed. The long call is `node -e "setTimeout(…)"` in `Bash`. Scripts, logs and transcript stayed in the 01a15f39 thread scratch and leave with it; one sample per case.

## Esc mid-tool-call

- Screen: "⎿ Interrupted · What should Claude do instead?", composer empty (`❯`).
- No Stop arrived, nor the interrupted call's `PostToolUse`.
- Transcript: `tool_result` and `user` "[Request interrupted by user for tool use]" ~0.65 s after the Esc record.
- The process is alive; the next word typed into the same PTY opens a new turn.

## Esc before the first token

Esc 0.3 s after Enter:
- `UserPromptSubmit` arrived, no Stop.
- The transcript has neither the turn words nor an interruption mark.
- The prompt text returned to the composer (`❯ Write a 300 word poem…`).

A next typed word would glue itself to it. A lone Esc (with ~1 s pause) does not clear the composer. Ctrl-U erases only the current line, and on the next press — the newline. Ctrl-C with a non-empty composer clears it whole, including a multi-line paste.

## Esc with a draft in the composer

A draft typed during `Bash` (no Enter) is not harmed by Esc: the turn is interrupted ("Interrupted · What should Claude do instead?"), the draft stayed in the composer. Sample of 2026-10-21, second session on the same version.

## Esc when idle

Two lone Escs ~1 s apart on an empty composer changed nothing on screen.

## Mid-turn words

Words typed during `Bash`:
- the screen shows them above the composer with the "ctrl+enter to send now" hint, in the composer — "Press up to edit queued messages";
- `UserPromptSubmit` arrived at once, with the running turn's `prompt_id`;
- transcript: `queue-operation` `enqueue` at input time, `remove` with `reason: absorbed_mid_turn` after the tool result;
- one Stop, `last_assistant_message` answers both words ("DONE\nBANANA").

Words typed at the Stop moment became a separate turn: same as in [[44dbe4a8]], T3.

## Screen

- Work: a counter row like `✶ Beboppin'… (10s · ↓ 102 tokens)` or `⎿ Running… (8s)`. The 2.1.306 screen has no "esc to interrupt" hint.
- Idle: composer between two rules `────`, a `❯` row; the turn total row with no ellipsis (`✻ Brewed for 3s · done 6:16 PM`).

## Returned prompt in the Tagma frame and long paste

Second probe of the same day, same version, bracketed-paste insertion as Tagma types:
- The `<input envelope=… length=… digest=…>` paste, a word row, `</input>` (four rows on screen with wrapping) after Enter and Esc returned to the composer as-is: same row breaks, continuations with two-space indent.
- A 28-row paste shows in the composer as one row "[Pasted text #1 +27 lines]": the number is the paste's newlines. After Enter and Esc, "[Pasted text #2 +27 lines]" returned to the composer: the number grew, the count is the same. The hint under the frame is "paste again to expand".

## Undetermined

- Esc in the text-stream phase and with an open permission dialog on 2.1.306 (on 2.1.293 — [[44dbe4a8]]).
- Whether Ctrl-C on an empty composer acts as the first exit step was not tried. So Tagma sends clearing only with a non-empty composer.
- Time from Esc to the prompt screen was not measured separately; the frame 1.5 s later already showed the prompt.
