---
id: 01a158e4-9a5a-7d05-bf28-57fd4354ca1d
title: "Changes tab: History view is all files the thread wrote, by turns and with their fates; Now without commits and a repeated heading"
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a125fe-9260-7644-9a64-589c9bc19e19",
    "status": "done"
  }
---
Changes tab: the History view is all files the thread wrote, by turns and with their fates; Now without commits and a repeated heading.

The operator agreed the layout http://localhost:5634/a/cc7ad85a3476. In the tab header a Now · History (· vs <base> in a worktree) switch instead of a repeated "Changes" heading. Now is only what the thread holds now. History is the thread paths' paged history by turns, newest first, each path with its fate (held, committed with commit, overwritten, returned to HEAD, etc.), fate filter; commits and "How lines ended" move here.

Server: an operator `read_thread_history` operation in the change record — the same turn history as `read_changes` (`turns`), without reading the thread's whole view; held reduces to cleared by one shared court judgment of the checkout. The client rereads the loaded window on `thread.changes` frames while the view is open, one request at a time.

Proof: operation test (page, cursor, cleared by court), client grouping and reread test, typecheck.
