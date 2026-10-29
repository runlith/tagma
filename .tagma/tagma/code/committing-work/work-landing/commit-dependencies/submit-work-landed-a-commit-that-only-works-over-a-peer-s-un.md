---
id: 01a14023-ae85-7923-8206-776803b72225
title: submit_work landed a commit that only works over a peer's uncommitted lines; the checkout build shipped the broken HEAD
ord: 5
tags: ["reflection"]
fields:
  {
    "actual": "The commit landed; HEAD kept the class ExternalBirthRows, so the detached `rows.create` lost `this`. The build installed at 14:52Z shipped it and every ACP/CLI harness birth failed with server-fault \"undefined is not an object (evaluating 'this.births.transaction')\" until a992e09050.",
    "command": "submit_work by port-external-harnesses (commit 601143c139, sessionBirths.ts: `create: rows.create`) while port-threads held an uncommitted closure rewrite of threads/birth/externalRows.ts",
    "expected": "A commit whose code depends on another session's uncommitted lines is either refused or named as depending on them, so a build from HEAD never ships a tree no session ever ran"
  }
---
Filed from project `runlith`.

Typecheck and tests ran on the working tree, where externalRows.ts was already closures (port-threads, aborted at 12:14Z, lines still uncommitted), so nothing saw the HEAD combination. Rule 621b98d5 accepts a HEAD that does not build between commits, but the checkout build installs HEAD, so the gap reaches the operator's running server.