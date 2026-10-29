---
id: 01a16e2e-c5e4-7c97-a343-fafdd5e0687e
title: delete_worktree refuses root-in-use naming an unrelated terminal started in the home folder
ord: 16
tags: ["reflection"]
fields:
  {
    "actual": "Both refused root-in-use naming terminal a2535ced (`claude auth login`, cwd ~, unplaced, started 2026-10-19 02:15, \"held by the operator\"), which had no file under either worktree; deletion succeeded only after stopping that terminal",
    "command": "delete_worktree({rootId:\"01a14b19-44ef-7127-b052-2e3b6799e1b0\"}) and delete_worktree({rootId:\"01a1370c-9920-7cfd-8d80-909be46be3de\"}) in project runlith",
    "expected": "The worktrees (own-ui, calls-stage-1), clean and idle for days, are deleted, or the refusal names what really holds their folders"
  }
---
Filed from project `runlith`.

Evidence, 2026-10-24 ~13:45Z:
- `lsof` on pid 62286 (the terminal's leader) showed only cwd ~, nothing under ~/.tagma-dev/worktrees/runlith/{own-ui,calls-stage-1}.
- The only processes with those folders open were orphaned git fsmonitor daemons (pids 73791 and 59575, ppid 1, started Oct 21 and Oct 20). Stopping them with `git fsmonitor--daemon stop` did not change the refusal. The same terminal blocked both worktrees at once.
- A third worktree in the same folder (tagma-0.1.6) was deleted in the same minute without that refusal.
- After stop_terminal on a2535ced, both deletions succeeded.
- The refusal's unblock ("end what holds it") pointed at a terminal the operator did not know existed and did not hold.
Separate fault, filed alongside: that terminal is a `claude auth login` PTY under the execution holder (ppid 18252) that hung for 5.5 days and spent 339.7 s of CPU, invisible to the operator.