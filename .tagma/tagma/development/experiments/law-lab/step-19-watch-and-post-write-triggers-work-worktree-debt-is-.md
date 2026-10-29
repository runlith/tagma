---
id: 01a16527-4e3b-7508-abd9-ba5869565218
title: Step 19 — watch and post-write triggers work; worktree debt is lost on a fast merge; review cannot be checked with an agent
ord: 37
tags: ["experiment"]
fields:
  {
    "status": "done",
    "verdict": "refuted"
  }
---
**Hypothesis** — (a) watch strictness lets a landing through and names the violation in `watched`, and the re-measure records its escape; triggers after `edit`/`write` tell the author when the file is written and record nothing; (b) debt accepted in a worktree arrives in main even when both the branch and main changed the graph; (c) review mode asks the parent when debt grows.

**Setup** — law-lab (project 39). (a) rule [[1f4c22f7]] (`Code.noReexports`) moved to watch, triggers `submit_work` before, `edit` and `write` after; then returned to gate before `submit_work` (revision `5a0694e36013`). (b) worktree `both-graphs` off `4db75a768d`, rule [[4e5d1446]] gate. (c) project 39's `agent.approvalMode` = review, child agent review-probe (Sonnet high); the setting reset afterwards.

**Observation**
- (a) `write` of a re-export → the `rule-escaped` signal "After write … stand in the file's new text against HEAD … Nothing was recorded" on the next step; `edit` — the same, two places. `submit_work` under watch landed (`b4f11aa364`) with `watched (1)`. Re-measure after ~10 s recorded the escape `@ b4f11aa364` with no holder. File deletion (`cd69557551`) — escape dropped.
- (c) The child was born in bypass, not in the project's review: `create_thread` takes no `approvalMode` next to `parent` — the mode is inherited from the parent by schema. No question came. Review cannot be checked with an agent: it needs a root thread in review whose questions go to the operator.
- Along the way the child showed: `finish_block` right after the commit that removed the violation says "remaining debt … owner ended" and tells to reassign; the re-measure dropped the entry after ~2 s. Reflection [[a38a095f]].
- (b) `create_block` and `enforce_rule absorb` with WT `checkout` (debt 2 → 3 in the WT graph), `submit_work` (`2fd9e1ff79`), immediately `merge_worktree` → merged `0204275`, the branch first took main. At merge time the WT graph with the debt was not committed; committed after (`04ed0bf`) and never reached main. In main: debt 2, escape `budget.ts:19 @ 2fd9e1ff79`. The merge did not refuse. Reflection [[a71a2a5a]]. The violation removed in main `2cad4a19ca`, task closed.

**Conclusion** — (a) confirmed. (b) refuted: a fast merge after absorb loses the debt. (c) not checked with an agent — the mode is inherited; the operator is needed. Defects handed off: finish-debt-race, merge-pending-graph.
