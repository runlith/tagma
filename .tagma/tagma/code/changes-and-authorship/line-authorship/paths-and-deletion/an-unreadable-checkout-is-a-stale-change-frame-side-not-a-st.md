---
id: 01a11d62-ac3a-70f3-88df-3caefccd2707
title: An unreadable checkout is a stale change-frame side, not a stream refusal; a deleted checkout leaves the frame
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/changes/stream.ts
---
The `thread.changes` stream and `read_changes {agent}` open the checkouts of the thread's held and committed lines: a cold read after a landing would otherwise lose its commits. A root that does not read becomes a frame side in `stale` state with a reason and no records. The stream does not refuse in that case: one missing worktree would otherwise sink the whole thread view, including the checkouts that do read.

A side leaves the frame (`gone` in the change frame) when the thread no longer holds lines in the checkout and the registry names the checkout deleted. The same judgement runs when the stream opens, before the first frame: otherwise a deleted worktree where the thread has only committed lines left would stand in the thread view as `stale` forever, and resubscribing would open it again. The thread's home checkout always stays.

Only a change in which the thread holds a line adds a checkout to the stream. A change whose lines the thread left does not reopen the checkout.
