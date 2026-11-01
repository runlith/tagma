---
id: 01a1646a-30fe-70a6-aa96-25c09d6cee47
title: Runner Cursor holds the SDK session in the thread process, while Tagma's native door executes its tools
ord: 16
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a16458-c462-7849-98a0-7c6114227879
sources:
  - kind: dir
    ref: packages/adapter-cursor/src/runner
---
Runner holds a local session of the official SDK separately from the server: the execution host survives Tagma restarts, and the SDK never enters the process serving the other threads. Built-in tools are off; a callback executes each tool through the shared relay with Cursor's original id. A message is sealed after all of its calls are announced, before hosting hands any of their results over: otherwise the history and order of the native door would diverge from the foreign loop. The adapter expects this order from the SDK; synthetic tests cover Tagma's side, while the live SDK order without a working key is unconfirmed.

A new session gets the journal with pictures; a continuation gets the thread store. The instruction hash is stored separately per session after the turn's confirmed end: after a crash the instructions repeat, but no delivery is invented. Instructions travel as a message because the SDK's system-prompt replacement requires separate server-side access. The catalog is pinned per turn, yet every call is still judged by the native door; ambiguous steer is unused, so one word is never delivered twice. Cursor's remote loop owns any compression inside the SDK session, and Tagma's configured fill threshold never retells or resets it. SDK 1.0.40 makes that compression invisible to Tagma: `onDelta` drops summary markers, stream task text has no completion proof, and checkpoint payloads have no public decoder. The API supplies per-turn spend, not a per-request context/window measurement, so the profile declares partial usage and Tagma invents neither a boundary nor a fill. Whether SDK-local autocompression runs, and at what fill, remains unestablished ([[81aee933]]). Manual compaction refuses because the SDK has no compaction API. A real context-overflow error uses the core's one last-resort fold/reset and continuation; an immediate second overflow is surfaced rather than repeated.

Store, homedir records, and SDK temp files point inside the thread scratch: one CURSOR_DATA_DIR is not enough for SDK paths built from HOME and the system tmp. Thread storage is freed by the thread lifecycle; same-named user Cursor directories never become Tagma storage. Fresh asks put their private SDK home and store beneath the ask process's scratch, so interrupting and killing that process still lets the ask owner remove its files. Their SDK session has no tools, and the result carries usage only when Cursor reports it.
