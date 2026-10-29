---
id: 01a17ea8-dfa1-7b94-bcf8-207eaab69873
title: "Worktree board: main as the base, groups by next step, one-phrase state, row as a link"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17ea9-60f6-7e1d-bc58-7bc7f841fe49",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03ca64c5c6e8
  - kind: relates
    to: 01a175bc-4df0-7e89-88ed-89730da203e8
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/worktrees/WorktreeBoard.svelte
---
The worktree board is rebuilt to the mockup the operator accepted: http://localhost:5634/a/267daee0f9bf. A table of nine columns, half of whose cells are “none”, “—” and “not taken”, with check freshness written in orange hashes, read as an MVP.

- `main` stands above the list as the base: its agents, uncommitted changes and `+/−`. It has no merge status, base distance or checks: it merges into nothing.
- The remaining worktrees are grouped by next step: Needs you (waiting on the operator, ready to merge, conflicts, behind), Working (agents working or an act running), Quiet, To clean up (merged, gone). An empty group is not drawn; inside a group the order is by last movement, the row under the cursor does not move away.
- A row's state is one phrase from status, checks and distance: “Ready to merge 6 commits”, “Conflicts with main”, “4 behind main”. The previous fact — a dimmed “checked 5h ago”, hashes and HEAD — is in the tooltip.
- Agents are `AgentCounts`, waiting and working, instead of dots with “+N” of all standing threads.
- A row is a link to its worktree's Git under the list-row law ([[0da203e8]]), there is no Open button. A row carries one button and only on a step: Merge… filled, Update and Delete outlined. The rest is the “…” menu and right-click.
- “Clean up…” stands in the To clean up group header. A missing worktree is an empty dashed diamond, not red: it is an absence, not a failure.
- Next to the branch stands, dimmed, the title of the task or thread the worktree was made for; read only for visible rows.
