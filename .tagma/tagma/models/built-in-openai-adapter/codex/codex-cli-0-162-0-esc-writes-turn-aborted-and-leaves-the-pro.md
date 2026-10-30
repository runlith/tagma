---
id: 01a15f62-0156-7d2c-b652-b7f07e38ec20
title: "Codex CLI 0.162.0: Esc writes turn_aborted and leaves the process and background calls; before the first token the prompt does not return to the composer; mid-turn words join the running turn — probe 2026-10-21"
ord: 5
tags: ["research"]
fields:
  {
    "source": {
      "name": "Live Codex CLI probe in PTY: Esc on a call and before the first token, mid-turn words, idle screen, rollout",
      "ref": "Codex CLI 0.162.0, GPT-6.1-Sol low; 2026-10-21; ~/.codex/sessions/2026/10/21/rollout-2026-10-21T18-19-09-01a15f42-….jsonl"
    }
  }
edges:
  - kind: relates
    to: 01a11d92-f13e-70e0-a79e-313114005f86
  - kind: relates
    to: 01a15eeb-6b48-7ca8-9c93-24d8d0f5ca7e
---
Codex CLI 0.162.0, model GPT-6.1-Sol with `model_reasoning_effort=low`, `--dangerously-bypass-approvals-and-sandbox`, default `CODEX_HOME` (`~/.codex`), 2026-10-21, one host (macOS). CLI in a 120×40 PTY raised via the Tagma terminal; input — PTY records (words by paste, Enter and Esc as separate records), screen — the host's text frame, rollout read from disk. No hooks were set in the probe. Long call — `node -e "setTimeout(…)"`. Logs stayed in thread 01a15f39's scratch; one sample per case.

## Esc mid-call

- Screen: "■ Conversation interrupted — use /feedback if something went wrong", composer back with the `› Ask Codex to do anything` placeholder, no `Working (… esc to interrupt)` line.
- Rollout: `response_item` `developer` with `<turn_aborted>` and `event_msg` `turn_aborted` with `reason: "interrupted"` and the turn's `turn_id`.
- The `turn_aborted` delay after Esc sits in the probe tooling, not in Codex. Probes typed Esc via a `tagma op write_terminal` call, and the timestamp was taken before the call. The `tagma op` call itself takes 1.2–1.9 s on this machine (three screen reads by the same path). So the first samples showed 0.6 and 4.5 s. In three repeated samples timestamps were taken before and after the call:
  - 40 s `exec` call — record 17:34:40.674–41.875, `turn_aborted` 17:34:41.837;
  - text stream — record 17:35:00.601–02.220, `turn_aborted` 17:35:02.185;
  - call after a mid-turn word — record 17:35:33.838–37.083, `turn_aborted` 17:35:37.097, 14 ms after the record's answer.

  In all three `turn_aborted` landed before the record call returned its answer, or within milliseconds after. Codex interrupts the turn as soon as Esc reaches the PTY. If a word joined the turn before Esc, the interrupted call's output (`wait`, `function_call_output`) also lands in the rollout before `turn_aborted`. Tagma's terminal transport types the key through its own input lane in the server process, with no `tagma op` call, so it has no such delay. No Tagma-side delay of its own was found.
- The call exec already moved to the background ("1 background terminal running") is not stopped by the turn interrupt.

## Esc before the first token

Esc 0.3 s after Enter:
- `task_started`, then `turn_aborted` after ~1 s;
- the prompt stayed in the screen history, the composer is empty — the text did not return to the input field.

## Esc with a composer draft

A draft typed during the call (no Enter) is untouched by Esc: the turn is interrupted ("■ Conversation interrupted"), the draft stays in the composer.

## Mid-turn words

Words typed during the call show at once in history as `› …` and are recorded in the rollout as a `user`-role `message` in the same turn (same `turn_id`, `item_completed`).

## Screen

The idle marker is the same as on 0.159.0 (`codexPromptScreen`): the composer placeholder with no "esc to interrupt".

## Composer with text

Second probe the same day, same version:
- Text in the composer is a `› <text>` line, continuations — lines indented two spaces. Then an empty line and a footer: the model line and the hint line, idle `? for shortcuts`, mid-turn `tab to queue message`.
- During a call the composer stands under the `Working (… • esc to interrupt)` line, empty — with the same `› Ask Codex to do anything` placeholder.
- Ctrl-C when idle clears a non-empty composer.
- A long paste folds into `[Pasted Content 1770 chars]` in the composer line.

## Not established

- Hooks (Stop, UserPromptSubmit) on 0.162.0 under interrupt: the probe had none. On 0.159.0 Esc did not call Stop — [[14005f86]].
- Ctrl-C; interrupt in the text-stream phase.
