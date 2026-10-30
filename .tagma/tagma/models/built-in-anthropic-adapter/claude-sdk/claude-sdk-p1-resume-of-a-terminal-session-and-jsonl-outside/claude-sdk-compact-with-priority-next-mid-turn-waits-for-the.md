---
id: 01a109d4-3a56-77b0-88a5-7060e78fa33c
title: "Claude SDK: /compact with priority next mid-turn waits for the turn end and goes as a separate turn — probe 2026-10-05"
ord: 1
tags: ["research"]
fields:
  {
    "source": {
      "name": "Live probe: /compact as SDKUserMessage with priority next during a turn with a tool",
      "ref": "@anthropic-ai/claude-agent-sdk 0.3.284, CLI 2.1.289, Bun 1.4.2, claude-haiku-4-5; 2026-10-05; scratch 01a10949…/probe-compact-next.ts"
    }
  }
edges:
  - kind: discovered-from
    to: 01a1089e-978d-7423-bc88-3a1f9d90bce3
---
One live probe, 2026-10-05: SDK 0.3.284 under Bun 1.4.2, `claude` 2.1.289, Haiku 4.5, `replay-user-messages`, a single `wait` MCP tool (waits 3 s) via in-process MCP. The script is `probe-compact-next.ts` in the 01a10949 thread scratch (leaves with the thread; its output below).

Turn: "remember PELICAN, call wait, call again, reply DONE". As soon as the first `wait` call started (1.9 s), an `SDKUserMessage` with `priority: 'next'` and text "/compact Keep only the word PELICAN." was sent into the same input.

## Observation

- 1.8–1.9 s: two `wait` `tool_use`s; 4.9 s and 7.9 s — their results; 8.8 s — the model step and `DONE` reply, the turn's `result` `success`, `queued_turn_count` 0. Between the tool results and the next step there was a step boundary (7.9 → 8.8 s), and `/compact` was **not** embedded in it: no echo, no `/compact` text in the turn, the model did not answer it.
- Right after the turn's `result` (8.8 s): `system/status compacting` → (9.7 s of compaction) `status null, compact_result success` → `system/init` → `system/compact_boundary` (`trigger: manual`, `pre_tokens` 1378, `post_tokens` 302) → synthetic `user` with retelling → `<local-command-stdout>Compacted </local-command-stdout>` echo → the command's own echo (`<command-name>/compact</command-name>… <command-args>Keep only the word PELICAN.</command-args>`) → a separate `success` `result` with empty text.

## Conclusion

Claude Code holds a mid-turn `/compact` with `priority: 'next'` until the turn end and executes it as the next separate turn of the same session; unlike regular text with `priority: 'next'` (embedded at the step boundary, [[b05a4728]]), it does not enter the running turn and does not go to the model as text. There is no "at the step" compaction a client could order: the earliest boundary is the current turn end.

Undetermined: behaviour with several commands in the queue, with steer words in the same queue, on cancelling a turn with a queued command, on other CLI versions; one probe — one sample.
