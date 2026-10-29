---
id: 01a0d55b-28a8-7228-a4fc-3a48c78cd6c5
title: "Judge landings and worktree merges through a port: per-line attribution, `inspect_work`, receipts, spans"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d605-c457-7e5b-801d-9986f15be6e6",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0d4db-9d7d-7a78-ab39-a9d0f2755a5b
  - kind: waits-on
    to: 01a0d55b-28a0-7508-9091-86e54fa1c5a8
  - kind: waits-on
    to: 01a0d55b-28a5-7d90-9254-8d0f99d493b0
---
Per [[f2755a5b]]: the landing-judge port declared in `working/` and filled by `enforcement/`; the judgement in `commitOwn` between build and commit and in the worktree merge before its commit; rules chosen from enforced rules by reach; facts from both trees; own versus carried by the change record per import line; the verdicts, `inspection-failed` at gate and lands at watch; `inspect_work`; the receipts' `watched`, `carriedViolations`, `unjudged`; spans `submit_work.gate` and `merge_worktree.gate`; the remaining landing budget as deadline. Done when the landing and merge acceptance items of [[f2755a5b]] hold in a fixture repository.