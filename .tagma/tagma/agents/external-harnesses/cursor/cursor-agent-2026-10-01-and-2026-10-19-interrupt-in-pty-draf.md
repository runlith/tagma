---
id: 01a15f90-065d-71b0-8ef6-58de30124bcd
title: "Cursor Agent 2026.10.01 and 2026.10.19: interrupt in PTY, draft, queue, and exit on repeated Ctrl-C — probes of 2026-10-21"
ord: 10
tags: ["research"]
fields:
  {
    "source": {
      "name": "Live Cursor Agent probes in PTY and a reading of the installed build's key handlers",
      "ref": "Cursor Agent 2026.10.01-e373342 and 2026.10.19-6bbf2c4, Auto; 2026-10-21; scratch 01a15f39…/probe and ~/.tagma-dev/scratch/01a16028-437d-73b6-a2e9-5077b58d8f64; installed bundle ~/.local/share/cursor-agent/versions/2026.10.19-6bbf2c4"
    }
  }
edges:
  - kind: relates
    to: 01a11d92-f133-7d83-8c00-8c9f3f8cfd9a
  - kind: relates
    to: 01a15eeb-6b48-7ca8-9c93-24d8d0f5ca7e
---
Cursor Agent 2026.10.01-e373342, model `Auto`, `--force`, 2026-10-21, one host (macOS). CLI in a 120×40 PTY raised through the Tagma terminal. Input — writes into the PTY: words by paste, Enter and keys as separate writes. Screen — a host text frame. Hooks — project `.cursor/hooks.json` with a logger (sessionStart, beforeSubmitPrompt, preToolUse, postToolUse, afterAgentResponse, stop). The long call — `node -e "setTimeout(…)"` via `Shell`. Logs remain in the scratch of thread 01a15f39. One sample per case unless stated otherwise.

## Interrupt key

- **Ctrl-C** interrupts both the `Shell` call ("Cancelled • 6.4s") and the text stream. The turn is interrupted even when the composer holds a draft: the draft stays.
- **Esc** interrupts the `Shell` call ("Cancelled • 5.4s") but **not** the text stream: the answer kept going. In the 2026-10-08 probe on the same version Esc did nothing mid-`Shell` ([[3f8cfd9a]]). The discrepancy is unexplained.

## What the key does to the prompt and the draft

- Ctrl-C **before the first token** (0.3 s after Enter) and **mid-stream** returns the prompt text to the composer (`→ Write a 600 word essay…`). Mid-`Shell` the composer stays empty (`→ Add a follow-up`).
- Ctrl-C on a **non-empty** composer while idle clears it entirely and shows "Press Ctrl+C again to exit". Ctrl-C on an empty composer while idle visibly did nothing (one sample, ~5 s after the previous one).
- **Ctrl-U** erases one composer line per press: first its text, on the next press the newline. A three-line draft took four presses. A one-line draft took one.
- Esc on a non-empty composer while idle did nothing.

## Input mid-turn

A word with Enter during `Shell` landed in a `follow-ups` frame (`○ Also say BANANA at the end`, hint "enter steer · ↑ select/edit · esc cancel"). `beforeSubmitPrompt` arrived at once with a **new** `generation_id`. The word left as a separate turn after the first one ended: two `stop` events with `status: completed`, the second one's `afterAgentResponse` was "DONE\nBANANA". Enter alone does not inject a word into a running turn. Moving input into a turn is a separate act from the frame ("enter steer"), not pressed in this probe.

## Ready confirmation

- `stop` arrives on every interrupt **twice**, with `status: aborted` and `status: error`, in either order: so on Esc and on Ctrl-C, on calls, in streams, and before the first token. By logger marks the first `stop` came 2.0–2.6 s after the key write. That time includes starting the hook's `node`.
- Screen: placeholder `→ Add a follow-up` without `ctrl+c to stop` — already on the first frame after the key (≤ 1.5 s). The placeholder is hidden when the prompt has returned to the composer.
- Transcript (`~/.cursor/projects/<slug>/agent-transcripts/<id>/<id>.jsonl`) right after an interrupted call ended with `{"type":"turn_ended","status":"aborted"}`. Later the file was **rewritten**: it kept only `user` turns that ran to completion or were interrupted on a call. Neither `turn_ended` nor turns interrupted in a stream or before the first token remained.

## Returned prompt in the Tagma frame and long paste

Second probe the same day, CLI already updated to 2026.10.19-6bbf2c4, pasted as Tagma prints it in bracketed paste:
- A paste of `<input …>`, a word line, `</input>` after Ctrl-C in a stream returned to the composer as-is: the first line after `→`, continuations indented by four spaces.
- A 28-line paste is shown in the composer as `→ [Pasted text #1 +28 lines]`: the count is pasted lines, not newlines, as in Claude Code.
- Twice the first Ctrl-C ~1–2 s after Enter, in the "Thinking" phase, did not interrupt the turn: "ctrl+c to stop" stayed on screen and the turn continued. The second Ctrl-C interrupted the turn in one sample and returned the prompt. In another the turn had already ended by itself, and what the second Ctrl-C did is unclear. The write delay through `tagma op` (1.2–1.9 s) is not excluded by these samples.

## Not established in the first probe

- The "enter steer" act in the follow-ups frame and what the hooks see then.
- Why Esc now acts mid-`Shell` when it did nothing on 2026-10-08.
- How long "Press Ctrl+C again to exit" lasts and whether the CLI exits on the second Ctrl-C in this window. For 2026.10.19 this is checked below.

## 2026-10-21: direct PTY, 2026.10.19 series, repeated interrupt

**Conclusion.** Losing the first Ctrl-C on Thinking did not reproduce: 5/5 turns were interrupted by the first key. An unconditional repeated Ctrl-C is dangerous: the CLI really exited both with an old frame still active and after `Cancelled`. Esc on this version interrupted Thinking, the text stream, and Shell with a plain empty composer, without arming exit. With a draft Esc did not interrupt the turn; Ctrl-C interrupted and kept the draft but armed exit. No single key fit for all states is established that works unconditionally.

### Conditions and reproducibility

Cursor Agent `2026.10.19-6bbf2c4`, `Auto`, `--force --trust`, macOS, PTY 140×50 via Python `pty.fork`. Each sample is a separate CLI in its own scratch workspace. `os.write(fd, b'\x03')` or `os.write(fd, b'\x1b')`, one write per key; `time.monotonic` before and after the write. Neither Tagma terminals nor `tagma op write_terminal` were used in this series. Enter was sent after raw-mode readiness and the bracketed-paste display.

Thinking is defined by the first `Thinking` frame before answer text; stream by already visible text; Shell by `preToolUse` and the marker file created by the command itself, then `sleep(45)`. Hooks are matched by `generation_id`. The logger marks time after its Python process starts; the hook delay includes its launch and is not the cancel delay. The screen is parsed from the ANSI stream; the read wait is 20 ms, and the delay includes process scheduling.

Saved experiment: `~/.tagma-dev/scratch/01a16028-437d-73b6-a2e9-5077b58d8f64/`: `probe.py`, `exit-probe.py`, `summarize.py`, `cursor-probe/.cursor/hooks.json`, `cursor-probe/hooks.jsonl`, raw `.raw` files and valid-sample `.jsonl` logs. Failed technical runs are out of the table; their journals are deleted. The JSONL holds exact write bounds, a UTC mark right after each, frames, and hook payloads. Repeat commands: `python3 probe.py thinking 5`, `python3 probe.py stream 5`, `python3 probe.py tool 5`; extra modes come from `PROBE_KEY`, `PROBE_DRAFT`, `PROBE_SECOND_WHEN`, `PROBE_SECOND_KEY`, `PROBE_REPEAT_SECONDS`. Repeat is off by default; in the original Shell-1 it was on after two seconds.

### Five samples per state, Ctrl-C

UTC — 2026-10-21, mark right after the write. All delays are ms from the end of the first `os.write`. "Screen" is the first stopped/calm frame; Shell additionally showed `Cancelled`. In all 15 samples `stop.status=aborted` was later recorded, usually also `error`. First Ctrl-C writes took 4.0–25.1 µs.

| Sample | UTC write | Screen, ms | stop(aborted), ms | Second key and outcome |
|---|---|---:|---:|---|
| Thinking-1 | 20:39:54.677 | 87.4 | 7332 | Not needed |
| Thinking-2 | 20:40:24.018 | 11.9 | 3327 | Not needed |
| Thinking-3 | 20:40:41.381 | 12.5 | 2854 | Not needed |
| Thinking-4 | 20:40:57.467 | 10.6 | 2989 | Not needed |
| Thinking-5 | 20:41:13.645 | 10.6 | 2231 | Not needed |
| Stream-1 | 20:41:38.659 | 10.8 | 2985 | Not needed |
| Stream-2 | 20:41:57.903 | 11.2 | 1830 | Not needed |
| Stream-3 | 20:42:18.149 | 10.2 | 1219 | Not needed |
| Stream-4 | 20:42:28.758 | 21.7 | 5341 | Not needed |
| Stream-5 | 20:42:52.353 | 127.1 | 4675 | Not needed |
| Shell-1 | 20:43:37.934 | 3037.0 | 7761 | Ctrl-C after 2155.7 ms; CLI exited |
| Shell-2 | 20:44:10.807 | 607.3 | 3351 | Not needed |
| Shell-3 | 20:44:35.461 | 618.4 | 3713 | Not needed |
| Shell-4 | 20:44:59.512 | 13.5 | 4169 | Not needed |
| Shell-5 | 20:45:22.294 | 111.0 | 3451 | Not needed |

Shell-1: before the second key the screen still held `Exploring`, `1 task`, `ctrl+c to stop`, with no exit banner. `Cancelled` appeared 881.3 ms after the second write; EOF of the PTY and `To resume this session` appeared 3924.3 ms after the second. This confirms the danger of repeating while an old frame is active, but does not prove the first Ctrl-C was lost: the first may already have been cancelling the turn while the screen lagged. This sample does not establish that the second key was needed.

In an extra background-Shell sample without repeat, the first Ctrl-C gave a cancel frame after 364.3 ms and `stop(aborted)` after 1615.3 ms. The name `AwaitShell` was not recorded in hooks. In separate attempts the CLI showed `Explored available MCP tools cursor · AwaitShell`, then `Waited for shell`, but hooks held Shell and Read. The exact moment of entering a real AwaitShell is unidentified; losing or delaying the first key exactly inside AwaitShell remains unchecked. Detecting the tool name does not count as calling it.

### Repeat and CLI exit: measurements

| State before second key | Keys and write interval | Fact |
|---|---|---|
| Old active Shell-1 frame, no banner | Ctrl-C → Ctrl-C, 2155.7 ms | Cancel 881.3 ms after second; then CLI exited |
| Already `Cancelled`, empty composer, exit banner | Ctrl-C → Ctrl-C, 481.6 ms | CLI exited 3103.1 ms after second |
| Calm, empty composer | Ctrl-C → Ctrl-C, 103.8 ms | EOF 2834.1 ms after second |
| Calm, empty composer | Ctrl-C → Ctrl-C, 1500.8 ms | EOF 1743.3 ms after second |
| Calm, empty composer | Ctrl-C → Ctrl-C, 2358.2 ms | Second showed the banner again; no exit in 5 s of watching |
| Calm, empty composer, exit armed | Ctrl-C → Esc, 108.7 ms | No exit in 5 s of watching |
| Thinking, then calm after cancel | Esc → Esc, 108.7 ms | `stop(aborted)`; no exit in 6 s after second |

These are bounded observations, not proof of unbounded absence of exit.

### Esc and draft: measurements

| State | Key and UTC write | Cancel fact | Draft and exit |
|---|---|---|---|
| Empty composer, Shell | Esc, 20:49:43.670 | `Cancelled` after 307.2 ms; aborted after 1760.3 ms | No exit banner appeared |
| Empty composer, text stream | Esc, 20:52:05.771 | Calm frame after 10.8 ms; aborted after 1292.4 ms | Prompt returned to composer, no exit banner |
| Empty composer, Thinking | Esc, 20:52:52.553 | Calm frame after 11.0 ms; aborted after 1250.8 ms | Prompt returned; repeat Esc did not close CLI |
| Shell and `DRAFT_KEEP_20261021` in composer | Ctrl-C, 20:55:41.048 | `Cancelled` after 13.6 ms; aborted after 2233.3 ms | Draft kept; exit banner appeared |
| Shell and same draft | Esc, 20:56:02.205 | No cancel: command ended with exitCode 0, answer `DONE`, stop(completed) after 50986.6 ms | Draft kept; no exit banner |

With a draft, `ctrl+c to stop` is hidden while Running. So the absence of that line alone is no fact of calm. In two draft journals an early harness `idle-screen` event wrongly treated the hidden placeholder as calm; it is not used as proof. For Ctrl-C the fact is the next `Cancelled` frame; for Esc it is the command's natural successful end. The predicate in the saved harness is fixed; the original measurements are left as they were.

### Installed-version code read

Directory `~/.local/share/cursor-agent/versions/2026.10.19-6bbf2c4/`, bundle `544.index.js`: modules `src/components/prompt-bar.tsx`, `src/hooks/prompt/use-exit-mode-arming.ts`; `index.js`: `src/constants.ts`; `800.index.js`: `src/utils/input-keys.ts`. This is a reading of the installed bundle, separate from the measurements:

- Ctrl-C first checks `exitMode` and exits in it; the `isProcessing` check comes later. On a running turn Ctrl-C calls cancel and arms (`arm("ctrlC")`) without clearing the draft. While idle it also arms exit.
- `use-exit-mode-arming` clears the mode after `constants.kd`, 2000 ms in this build. That is time after the CLI handles the key, not after the PTY write; the transport cannot turn a two-second count from its own write into readiness fact.
- In plain message mode Esc and Ctrl-G share one branch. It calls cancel only with an empty composer and a running turn, without arming exit. Caret position does not change the text-length condition. Ctrl-D on a running turn also arms exit.
- Before cancel on Esc there are interceptions: a slash/@ palette closes, history resets, and with queued input and an empty composer **onCancelFirstQueued** runs. An Esc series can delete waiting words. Deleting a queued word by Esc and history interception mid-turn are established by code reading; opening and closing the slash palette were checked by an extra sample below.

The `Press Ctrl+C again to exit` banner is a positive sign of the danger of a repeated Ctrl-C. Its absence does not prove safety: the CLI state can run ahead of the frame. Likewise a late stop hook confirms the turn ended but does not set a safe moment for a repeated Ctrl-C.

### Queued word and mode signs: extra sample

During Shell the TUI received `Reply only QUEUED_MARK_20261021 after this turn.` and Enter. Before the interrupt the separate `follow-ups` frame, the `○ Reply only QUEUED_MARK_20261021 after this turn.` line, and the `enter steer · ↑ select/edit · esc cancel` hint were visible. This is the observable positive sign of queued mode that can be read from the same frame that precedes the key write.

One Ctrl-C, UTC 21:01:09.680, gave `Cancelled` after 54.7 ms and stop(aborted) of the original generation after 2500.7 ms. The queued line stayed in the frame after the cancel and after the exit banner disappeared. Its Enter had already produced a separate beforeSubmitPrompt with generation `5756a7c5-f9a3-4146-ae0f-d3846429df97`, but in 30 s of watching after the original turn's hook end neither afterAgentResponse nor stop of that generation arrived, and no new active turn started. What is measured is the word kept and no automatic start in this window, not a promise of endless waiting. In this probe Esc was not pressed in queued mode; its onCancelFirstQueued is established by code reading.

Slash palette was measured separately: after `/` the composer shows the `/model [filter]`, `/goal [objective]`, `/add-dir [path]` list and other commands, the picked line marked by an arrow; Esc closes the list and clears a lone `/`. This is a positive on-screen sign of key interception. History was checked after a real sent and cancelled Shell word: up-arrow put the original prompt back into the composer. There is no separate frame, history signature, or picked-word index on the frame; a later Esc left the visible text the same. From one such frame the transport does not distinguish picked history from a plain draft with the same bytes. This is a calm sample; history interception mid-turn is known from the bundle, not from a separate measurement.

### Decision for the 2026.10.19 profile

| State | Key | Interrupt fact | Draft/queue | Can a repeat close the CLI |
|---|---|---|---|---|
| Plain message mode, empty composer, no queued/history/palette | Esc | Cancel measured on Thinking, stream, and Shell; then stop(aborted) | Prompt may return after cancel | Esc does not arm exit; repeat after the stop was checked with no exit |
| Has a draft, plain message mode | One Ctrl-C | Cancelled and stop(aborted) measured | Draft kept | **Yes**, repeat Ctrl-C in arm-exit closes the CLI; repeating blindly is unsafe |
| Has a draft, attempt without arm-exit | Esc or Ctrl-G | Esc did not cancel the turn; Ctrl-G shares the branch by code | Draft unchanged | Arms no exit but does not stop |
| Queued, empty composer; follow-ups frame, ○-line, and enter steer / esc cancel visible | One Ctrl-C; **not Esc** | Cancelled after 54.7 ms and stop(aborted) after 2500.7 ms measured | Queued word kept; no self-start in 30 s after the end. Esc deletes the first queued word by code | Repeat Ctrl-C can close the CLI; an Esc series is dangerous to the queue |
| Slash/@ palette; for slash a separate command list under the composer measured | Esc first closes the palette; cancel needs a separate later act in plain mode | Closing the list is no confirmation of turn cancel | A lone `/` cleared when the slash palette closes; other drafts not measured separately | Esc does not arm exit; Ctrl-C in plain mode arms |
| History; only the picked text in the composer on the frame, no marker found | Esc resets history by code; safe recognition of the state from one frame is unestablished | Resetting history is no turn cancel | In the sample the picked prompt stayed visually after Esc | Esc does not arm exit; Ctrl-C arms and can exit on repeat |

On this evidence: for a confirmed plain empty composer, Esc, with the next word ready once the turn's end is a fact; repeated stops must never blindly print Ctrl-C. For a draft, one Ctrl-C with the text kept and the turn cancelled is confirmed, but a safe repeat without exit risk is unestablished. No one-key way to keep a non-empty draft, cancel the turn, and not arm exit exists in the handler as read; caret movement does not help, Ctrl-G shares the Esc limit, Ctrl-D also arms exit. Removing/restoring the draft as an edit sequence is unverified and is not proposed here as a proven mechanism.
