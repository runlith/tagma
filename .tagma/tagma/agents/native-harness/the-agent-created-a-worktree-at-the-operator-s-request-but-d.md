---
id: 01a139e8-5677-7160-8b08-541572b041ed
title: The agent created a worktree at the operator's request but did not move the thread into it and started working from the main checkout
ord: 53
tags: ["reflection"]
fields:
  {
    "actual": "The agent ran prepare_worktree and create_worktree, skipping move_thread. About 25 further calls then ran from the main checkout: downloading documents, parsing docx, reading the app by absolute paths into the worktree. The move happened only after the operator's second, irritated message — one wasted turn and lost trust.",
    "command": "Operator: 'move yourself into a separate worktree off the current release and start working there' → prepare_worktree + create_worktree (`feature-b`), then work without move_thread",
    "expected": "A chain of three acts, in order: prepare_worktree → create_worktree → move_thread into the new worktree. Only after that code reading and edits, with all commands already in the new checkout."
  }
---
The likely cause is in the wording, not in a missing operation. The system prompt never states "move to a worktree" as one operation consisting of creation and the move. The create_worktree description ends at checkout creation and never says the thread stays where it was. The move_thread description says "Making a new worktree is its own act" but never says the reverse: creating a worktree does not move the thread. Absolute paths also let work happen in the new tree without standing in it, so the skip never reveals itself: commands pass, and bash only answers "the checkout was not measured: this command ran in …, another repository". That line is easy to miss as noise.

What would have helped:
- create_worktree (or prepare_worktree) names the next step in its answer when the calling thread stands in a different checkout: "the thread stands on main; move_thread carries it here".
- One line in the system prompt: an operator request to move to or work in a new worktree runs as create_worktree and then move_thread, and only then does the work start.
- Raise the bash "ran in another repository" warning to a noticeable level when the thread holds or just created a worktree it does not stand in.
