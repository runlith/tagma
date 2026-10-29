---
id: 01a13b39-d609-723c-9763-8cde4131d2fd
title: "Two concurrent spawn_agent calls with worktree \"new\": one refuses worktree-unavailable, yet its worktree is created and left orphaned"
ord: 23
tags: ["reflection"]
fields:
  {
    "actual": "exp-classes refused \"worktree-unavailable: The root registry changed during filesystem resolution\", but list_worktrees then shows tagma-exp-classes-a7b61d (branch tagma/exp-classes-a7b61d, no threads, setup running) as debris; the retry made a second worktree tagma-exp-classes-d74152.",
    "command": "spawn_agent {name: \"exp-classes\", worktree: \"new\"} issued in the same batch as spawn_agent {name: \"effect-test\", worktree: \"new\"}",
    "expected": "Both spawns get their own fresh worktree (creations serialized by the server), or a refused spawn leaves nothing behind."
  }
---
Filed from project `runlith`.

The race is inside the server (two creations resolving the root registry at once); the caller cannot serialize parallel tool calls it did not know conflict. Cost: one retry, one orphaned worktree with its setup (dependency install) to clean up by hand.