---
id: 01a12337-633e-7f16-ab51-06c3f2afdfd3
title: A thread run's end with `bindings.app` is delivered to the app's `on.ended` tool through a notification obligation, at-least-once
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/harness/pluginEndings.ts
---
Threads declares the `on` point because run ends belong to it. Delivery is a recipient `plugin endings` of the thread-events owner, not a separate queue: the owner subscribes it to the run-end notification obligation under that name, so claim, retry and `notification-exhausted` with `redeliver_ending` already exist, and already-delivered subscribers are not called on retry. It stands after the ending stages.

- The recipient is named by the thread's `bindings.app`. Only runs (`turn`) are delivered; keep-warm and compaction are not.
- The call goes through the app's supervisor. During a restart it awaits the new process, so an end that landed on the restart is picked up by the next process.
- No registered `on.ended`, while the app is installed, enabled on the machine and not running (start, backoff after a crash, boot before `TagmaApps.start`) — the subscriber fails and the end repeats. Readiness is asked of `TagmaApps.pending(id)` without walking directories, and after that answer the hook is read again: a process that published `on.ended` during the read receives the end instead of losing it. The obligation retries one minute after claim, no more than three times. A running app without `on.ended`, a disabled or uninstalled one — the end is skipped: there is nobody to hand it to.
- The tool's answer confirms delivery, and an error answer means a retry. The app accepts the end idempotently by `runId`.
