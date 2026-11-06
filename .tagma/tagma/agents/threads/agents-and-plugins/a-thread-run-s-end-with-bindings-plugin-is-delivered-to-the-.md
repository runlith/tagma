---
id: 01a12337-633e-7f16-ab51-06c3f2afdfd3
title: A thread run's end with `bindings.plugin` is delivered to the plugin's `on.ended` tool through a notification obligation, at-least-once
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/harness/pluginOn.ts
---
Threads declares the `on` point because run ends belong to it; the point's `asked` tool takes the questions of the plugin's threads, which are delivered once with no obligation and handed back to the person on failure ([[9d7d0b8c]]). Delivery is a recipient `plugin endings` of the thread-events owner, not a separate queue: the owner subscribes it to the run-end notification obligation under that name, so claim, retry and `notification-exhausted` with `redeliver_ending` already exist, and already-delivered subscribers are not called on retry. It stands after the ending stages.

- The recipient is named by the thread's `bindings.plugin`. Only runs (`turn`) are delivered; keep-warm and compaction are not.
- The call goes through the plugin's supervisor, so it opens an idle process, waits through a restart or a crash's backoff gate, and an end that landed on a restart is picked up by the next process.
- No registered `on.ended` while the plugin is installed and runs in some project but its contributions are not published yet (boot before `PluginHost.start`, the host not having taken it up, a manifest refused or unreadable at its first read) — the subscriber fails and the end repeats. Readiness is asked of `PluginHost.pending(id)` without walking directories, and after that answer the hook is read again: a plugin that published `on.ended` during the read receives the end instead of losing it. The obligation retries one minute after claim, no more than three times. A running plugin without `on.ended`, one running in no project, or an uninstalled one — the end is skipped: there is nobody to hand it to.
- The tool's answer confirms delivery, and an error answer means a retry. The plugin accepts the end idempotently by `runId`.
