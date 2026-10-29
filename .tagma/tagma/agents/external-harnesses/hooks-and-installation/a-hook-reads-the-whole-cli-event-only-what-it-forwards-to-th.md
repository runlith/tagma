---
id: 01a172fe-f42d-7fa6-aa17-d83e8ed5962b
title: A hook reads the whole CLI event; only what it forwards to the server is bounded
ord: 8
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/hooks/dispatch.ts
    symbol: hookText
---
Event size is no reason to lose it. Claude Code puts whole files into `PostToolUse` edits: `Edit` carries `tool_response.originalFile`, `Write` carries `tool_input.content`. The 32 KB stdin limit (`HARNESS_HOOK_BYTES`) silently dropped such an event for any file above roughly 30 KB: the base was taken in `PreToolUse`, the write was never sent, and the edit lines landed ownerless while `submit_work` could not cut the session's lines out of the file. `Stop` with a long answer and large `observe` events dropped the same way.

No limit is needed on input: everything bound for the server is bounded where it leaves — event keys (`carried`), call output (`HARNESS_CALL_OUTPUT_MAX`), the answer (`HARNESS_ANSWER_MAX` with `cut`), the prompt. The `shell` command goes whole, as with native `bash`: the window measures the command that ran. Reading is bounded only by time (10 s), and a read failure and broken JSON still turn into `undefined` ([[b1f87087]]).

`observe` carries a call report like `post-tool-use`: `PostToolUseFailure` arrives there and closes the call opened by `PreToolUse`, along with its Bash window ([[fdf1f592]]). Without that a failed call stayed `input-available` with its command window until the turn end.
