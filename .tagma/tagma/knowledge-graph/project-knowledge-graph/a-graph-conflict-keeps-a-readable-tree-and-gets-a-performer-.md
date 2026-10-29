---
id: 01a11be4-6d4e-72e3-a310-29a8c0f2bb2a
title: A graph conflict keeps a readable tree and gets a performer via the "Assign to agent" action
ord: 11
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
The server detects an automatic graph-merge conflict at merge time, not the next reader. The project keeps a standing notice with the branches, the recovery state, and an "Assign to agent" action. Pressing it creates a recovery thread with diagnostics and both conflict sides; pressing again opens the already assigned thread. The agent asks the operator when the facts need a meaning decision. The notice is removed once the merge completes successfully.

## Boundary and storage

The owner is graph: the merge attempt runs in a separate detached graph worktree; the served branch changes only after success. The conflict record and the recovery worktree sit next to the shadow Git and survive restarts. The source target, the incoming commit, branches, paths, and the assigned thread enter the record, readable without opening a mirror. An unfinished merge already left in the served stealth tree moves wholly into the recovery worktree with index and files preserved; the readable target is restored at the old address. Neither side is picked automatically. The team storage keeps the project's own git process.

Graph provides the recovery read and completion operations plus live state; threads owns thread creation and launch on press. The app shows the state and passes the act to the owner — it does not build the diagnosis or resolve the conflict. The threads → graph dependency stays pointed down. The action does not copy the error text to the clipboard or ask the person for manual commands.

## Concurrency and completion

Reopening does not start a new merge for the same pending conflict. On publish the target is checked: new work is not overwritten, and a changed target must be included in the resolution. An unfinished, damaged, or invalid result refuses explicitly and keeps the recovery. A failed agent launch leaves the conflict visible and allows the action again. Chats are available on recovery errors regardless of the graph.

## Verification

Owner tests with real Git prove: a conflict does not change the served tree; the sides and state read after reopening; a previously left unfinished merge moves without losing index and work files; an unfinished resolution is not published; a successful completion publishes both sides and drops the incident; a moved target does not lose new records. The launch check proves the agent gets the right project and diagnostics and a repeat request does not spawn threads. The UI passes typecheck and token checks; independent review was disabled by the operator in this session. The running server is not restarted by an agent.
