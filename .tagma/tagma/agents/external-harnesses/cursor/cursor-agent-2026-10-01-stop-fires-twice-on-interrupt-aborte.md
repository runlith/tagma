---
id: 01a11d92-f133-7d83-8c00-8c9f3f8cfd9a
title: "Cursor Agent 2026.10.01: Stop fires twice on interrupt (aborted and error), words open a new turn at once, timestamp-free transcript — probe of 2026-10-08"
ord: 9
tags: ["research"]
fields:
  {
    "source": {
      "name": "Live T1–T5 probes in PTY: Esc and Ctrl-C on thinking and Shell, mid-turn words, slowed Stop hook, 200 s Shell, on-disk transcript",
      "ref": "Cursor Agent 2026.10.01-e373342, Auto (free plan); 2026-10-08; scratch 01a11d5b…/probe (cursor.hooks.jsonl)"
    }
  }
edges:
  - kind: discovered-from
    to: 01a11ca5-7ddf-7f42-a891-bd659b043055
---
Cursor Agent 2026.10.01-e373342, model `Auto` (named models unavailable on the free plan: launching with `composer-2.5-fast` gave Stop with `status: "error"` after 2 s and "Named models unavailable"), `--force --trust`, 2026-10-08, one host (macOS). Hooks — project `.cursor/hooks.json` with a logger (sessionStart, beforeSubmitPrompt, preToolUse, beforeShellExecution, postToolUse, afterAgentResponse, stop, sessionEnd); the transcript was read from disk. Tool: `node -e "setTimeout(…)"` via `Shell`. Measurements [[a621fbb3]], T1–T5.

## T1. Turn end on interrupt

Observations:
- **Stop fires on interrupt**, with a `status` field, and **twice**: `status: "aborted"` and `status: "error"` with the same `generation_id`, up to 0.5 s apart; order is not stable (Esc — "aborted" then "error"; Ctrl-C — "error" then "aborted", within one millisecond).
- Esc in the thinking phase (before the tool) interrupts the turn, and the prompt text returns to the input field. Esc mid-running `Shell` does nothing — the command ran to the end. Ctrl-C ("ctrl+c to stop") mid-`Shell` interrupts: "Cancelled • 42s".
- Finished turn: one Stop with `status: "completed"`; `afterAgentResponse` arrives nearby, in both orders (in one turn before Stop, in another after).
- An interrupted turn's transcript ends with `{"type":"turn_ended","status":"aborted","error":"User aborted/interrupted manually."}`; finished turns have no such record.
- There is no idle notification (the Cursor hooks list has no `Notification`).

Conclusion: Stop at Cursor marks the end, including interrupts; tell them apart by `status`, and fold the double Stop of one interrupt by `generation_id`.

## T2. Words mid-turn

`beforeSubmitPrompt` fires **at input time** with a **new `generation_id`**; the answer to the words arrives as a separate turn after the first turn's Stop (a second Stop and `afterAgentResponse` "BANANA" 7 s after the first). In the transcript it is a separate `user` record `<user_query>MIDWORD…` after the "DONE" answer.

## T3. Words during the Stop hook

The Stop hook was slowed to 40 s: words typed 3.6 s after Stop gave `beforeSubmitPrompt` at once, the answer came 3 s later while the first Stop hook was still sleeping. The Stop hook does not delay the next turn; no words are lost.

## T4. Longest call

- `Shell` for 45 s: `postToolUse` with `duration` 49.5 s (`timeout: 60000` picked by the model).
- `Shell` with `timeout: 300000` for 200 s: `preToolUse` at 6.3 s, `postToolUse` at 209.8 s (**203.5 s**), in the foreground, with no hooks between them. The limit was not reached; the UI hint is "ctrl+b twice to send to background".

## T5. Transcript

- The payload carries the path for some events only: `transcript_path` is `null` for `sessionStart`, `beforeSubmitPrompt`, `preToolUse`; set for `beforeShellExecution`, `postToolUse`, `afterAgentResponse`, `stop`. It is `~/.cursor/projects/<cwd slug>/agent-transcripts/<conversation_id>/<conversation_id>.jsonl` (`session_id` in hooks matches `conversation_id`).
- Format — JSONL `{role, message:{content[]}}` (`text`, `tool_use` blocks). **Records carry no timestamp**; a `user` record embeds a `<timestamp>Thursday, Oct 8, 2026, 11:44 PM (UTC+2)</timestamp>` tag — minutes, local zone. The write time can only be taken from the file mtime.
- `afterAgentResponse` carries `text` (the full answer text) and token counters; `stop` carries `status` and counters.

## Not established

- Which of the "aborted"/"error" reactions is primary and whether "error" happens without an interrupt (seen once with an unavailable model).
- Guest environment; clock skew; other models (free plan); `sessionEnd`; a subagent sign in the payload.
