---
id: 01a15f90-0721-7c72-be04-3eedd3668d90
title: "Grok Build 1.0.62: interrupt is Ctrl-C, with a draft the first Ctrl-C clears the field and Ctrl-Z brings the draft back; Claude hooks are off by a foreign compat setting, native `.grok/hooks` works; Esc never interrupts — probes of 2026-10-21"
ord: 2
tags: ["research"]
fields:
  {
    "source": {
      "name": "Live Grok Build probe in PTY: Esc and Ctrl-C on a call, in a stream, and before the first token, composer draft, mid-turn words, updates.jsonl and events.jsonl",
      "ref": "Grok Build 1.0.62 [stable], Grok 4.5 (low); 2026-10-21; ~/.grok/sessions/…/01a15f80-dc93-75b2-886e-f522806a3ad4"
    }
  }
edges:
  - kind: relates
    to: 01a11d92-f15c-7933-a666-38876787fb19
  - kind: relates
    to: 01a15eeb-6b48-7ca8-9c93-24d8d0f5ca7e
---
Grok Build 1.0.62 [stable], Grok 4.5 model (low), `--always-approve`, 2026-10-21, one host (macOS). CLI in a 120×40 PTY raised through the Tagma terminal. Input — writes into the PTY: words by paste, Enter and keys as separate writes. Screen — a host text frame. Transcript — `~/.grok/sessions/<cwd>/<session>/updates.jsonl` and `events.jsonl`. Project hooks (`.claude/settings.json`) did not fire in the first probe: the logger recorded no event. The cause was found in the second probe the same day ("Hooks" section). Long call — `node -e "setTimeout(…)"`. Logs stayed in the scratch of thread 01a15f39. One sample per case.

## Interrupt key

- **Ctrl-C** interrupts a turn on a call, in a stream, and before the first token: "Turn cancelled by user in 25s".
- **Esc** does not interrupt a turn: the screen answers "Press Ctrl+c to cancel the turn", and the call continues.
- **With a draft in the composer**, the first Ctrl-C clears the **field**, not the turn: "Input cleared · ctrl+z to undo", and the call continues. The next Ctrl-C interrupts the turn.
- Ctrl-C on an empty composer while idle visibly did nothing (one sample; CLI exit is `ctrl+q`).

## What the key does to the prompt

After Ctrl-C on a call, in a stream, and before the first token the composer is empty (`❯`). The prompt does not return to the field.

## Input mid-turn

A word with Enter during a call queued up (`#1 Also say BANANA at the end`, "Queued · Enter to send now"). It left as a separate turn after the first one ended: "DONE BANANA".

## Ready confirmation

- Transcript: `updates.jsonl` — `turn_completed` with `stop_reason: "cancelled"`; `events.jsonl` — `{"type":"turn_ended","outcome":"cancelled","cancellation_category":"mid_turn_abort","cancellation_context":{"trigger":"ctrl_c"}}`. About 0.6 s after the key in all three phases. The `updates.jsonl` mark is whole seconds.
- Screen: composer `❯` with no working line. The profile has no prompt recognizer.
- The Stop hook never arrived on interrupt on 2026-10-08 ([[6787fb19]]). Hooks did not work in this probe, so that is not re-checked.

## Hooks

Second probe of 2026-10-21, same CLI and folder (trusted in `~/.grok/trusted_folders.toml`), the logger writes the event name, the session, and `GROK_*` variables.
- `~/.grok/config.toml` holds `[compat.claude] hooks = false` marked "superset-managed-grok-compat": a third-party Superset wrote it. Grok docs (`~/.grok/docs/user-guide/10-hooks.md`, `26-config-reference.md`) call this the switch that turns off Claude-hooks reading; `GROK_CLAUDE_HOOKS_ENABLED` does the same.
- The native `.grok/hooks/probe.json` file (Claude format: `{"hooks": {Event: [{hooks: [{type, command}]}]}}`) fired with compatibility off: SessionStart, UserPromptSubmit with `promptId`, Stop with `reason: "end_turn"`. `.claude/settings.json` records never launched.
- Hook env carries `GROK_SESSION_ID` (equals the event's `session_id`), `GROK_HOOK_EVENT`, `GROK_HOOK_NAME` (`project/probe:stop[0].hooks[0]` for `.grok/hooks/probe.json`, `project/settings:…` for `.claude/settings.json`), `GROK_WORKSPACE_ROOT`, `CLAUDE_PROJECT_DIR`.
- With `GROK_CLAUDE_HOOKS_ENABLED=1` Grok launched both files. UserPromptSubmit with different commands in the two files arrived twice. Stop with the same command in both arrived once, from `.claude/settings.json`.

## Ctrl-Z after Ctrl-C with a draft

- Draft in the composer during a call, then Ctrl-C, Ctrl-C (turn interrupted: `turn_ended` `cancelled`, "Turn cancelled by user"), then Ctrl-Z: the draft returned to the composer. Same when the three keys went as separate writes without pauses.
- Without a draft: Ctrl-C, Ctrl-C interrupted the turn, and Ctrl-Z returned that turn's sent prompt to the composer.

## Composer

Composer is a `╭─…╮` frame, a `│ ❯ <text> │` line, bottom `╰─… Grok 4.5 (low) · always-approve ─╯`; empty — `│ ❯ │`, both idle and during a call (the working line `⠸ … [↓][stop]` stands above the frame). A multi-line paste folds to `[Pasted: 3 lines]` in the same line; the expanded text sits in a separate frame above the composer ("paste again or double-click to expand"). Ctrl-C on a non-empty composer while idle clears it.

## Not established

- What "Enter to send now" does to the queue.
- How the composer draws multi-line text typed rather than pasted.
