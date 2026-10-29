---
id: 01a15244-a1fd-7f43-be29-a5e732b3b053
title: A foreign-CLI hook waits for its own server answer with no deadline of its own; its limit is the vendor's hook timeout
ord: 7
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/hooks/delivery.ts
---
Every hook delivery — an event report, a file write, the shown-place law, orientation — waits for the Tagma server's answer, refusal, or unreachability; the hook itself sets no deadline (rule 7609a86c). A deadline here harms twice: a cut call loses what cannot be recovered later (a call report or a turn-start, the shown-files law), and cancelling the request cancels the graph opening on the server that the request started (the graph pool intends this), so the next hook finds the graph cold again and is cut again.

Only the vendor cuts a hook, by its own timeout (60 s by default in Claude Code; for `PermissionRequest` Tagma sets 300 s). The only self-imposed limit is the long poll for an approval-question answer (`hold`): the server itself answers `Waiting`, and the whole cycle is bounded by `PERMISSION_TIMEOUT_SECONDS`. The file write lands on disk before sending, and when the vendor has killed the hook the next hook of the same session delivers it.
