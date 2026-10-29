---
id: 01a16fdd-d872-78ce-9452-4078988d91e8
title: "A question raised from the CLI screen lives only while the CLI shows it: both the screen watcher and a delivery that finds the screen without it close it"
ord: 6
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/asks/screen.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/asks/terminal.ts
  - kind: file
    ref: packages/agent/src/thread/run/RoutedAnswers.ts
---
A question from the screen (`data.screen`) is the CLI screen itself: it can only be answered with keys while the screen stands. So the `gone` outcome of a delivery is not "the answer is kept until asked again" for it, as with a permission question whose hook was lost (that one waits for its widget and gets the answer via redeliver into `widgetSeen`) — it is the end of the question: the delivery closes it `cleared`, and the door answers "no longer answerable", not "answered". Otherwise the question would stand `open` until the end of the run, the window would hang over the terminal, and every answer would fall into `gone` again — as happened with the folder-trust screen, which the operator answered by keyboard before answering by button.

The screen watcher reconciles open questions with the screen by level, not by one sighted front: at its task start and on run change, on every new settled question on screen, and while reconciliation skipped a question with a delivery in flight (`deliveryUnknown`) or a live hook. The front is lost: the watcher task restarts with empty memory, and a screen that changed between two quiet steps is otherwise invisible. It confirms a new on-screen question with a fast step, not a quiet one — otherwise a short screen (Bypass Permissions after trust) would never become a question. The next step wakes a screen that settled: the watcher task subscribes to `ScreenSettled` of its execution with a fast-step window. A question drawn by the CLI rises through this window and the confirm step, not through the 5 s quiet step. While the CLI animates there are no events, and the watcher does nothing beyond quiet steps. The quiet step remains for what is not on screen: run change, words waiting for a screen with no question, and a question closed past the screen. A subscription that ended in anything — a refusal, a connection end on host change, or an execution that does not exist yet — the task raises again via a quiet step while it lives. A host without `screen-settled` leaves the task on steps alone until a host serving that capability replaces it. The thread's previous task is interrupted by the new one's first step, outside `jobsHeld`: the table does not wait for the host's answer, and two tasks of one thread never reconcile the screen interleaved. If an announced screen still stands while its question is already closed, the watcher raises it again.

Writing a question through the ledger does not change the session facet, so the ledger itself publishes the thread snapshot after recorded `asked` and `resolved`; without that, the feed and snapshot subscribers learned of a question only on the next facet change.
