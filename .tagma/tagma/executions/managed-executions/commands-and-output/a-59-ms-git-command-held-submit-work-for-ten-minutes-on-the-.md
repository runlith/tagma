---
id: 01a0f579-d0bf-72d8-a1fc-f03f9848cb9f
title: A 59 ms git command held submit_work for ten minutes on the shared inventory feed
ord: 21
tags: ["reflection"]
fields:
  {
    "actual": "Execution c3326ebe-d24b-4fa7-aa5f-33ec403f3e12:81 ran git write-tree successfully in 59 ms; Terminals.acquiring waited 599999 ms for inventory updates, and ShadowGit.answer returned only after 600055 ms. Trace 6dc1b934166b5bfc348b0ac820415ed8, span fae8f4c79d58d0b1, server instance 8dfcca12-89c0-4f4b-aaae-f192482cec63, build 20260930T230630901Z.",
    "command": "submit_work in thread 01a0f552-a88f-762e-9559-a849c616b104, call_OQC5X7RB1XO9fAIwtkgJWTVU",
    "expected": "A queued internal git command returns its measured ending as soon as the host finishes it."
  }
---
Filed from project `runlith`.