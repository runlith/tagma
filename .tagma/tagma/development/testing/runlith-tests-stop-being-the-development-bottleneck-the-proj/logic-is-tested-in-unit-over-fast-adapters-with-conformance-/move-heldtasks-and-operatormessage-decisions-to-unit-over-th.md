---
id: 01a16e6b-40be-747b-a76d-6d9b1b284005
title: Move heldTasks and operatorMessage decisions to unit over threads ports
ord: 30
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16ded-91b6-7920-b042-6c8487cbafcb",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16b01-cb85-7e31-9936-47664dbd9a84
---
HeldTasks.left and ReaderMarking.spoke decisions moved into 8 unit tests over existing ports; one real boundary left in each source itest. Commits 5f43cad50a and 1d55a057ba; all 4 files green individually on seeds 1–3. Profiles before edits: 20.6 and 10.4 s CPU; threads share in self — 2.2% and 2.6%, the rest mostly runtime, Effect and SQL. After: cold itests 10.9–12.5 and 7.1–7.9 s, units 0.37–0.61 and 0.43–0.46 s with no child processes; git 255→114 and 48→34–37. Measurements taken under parallel edits and load, no quiet factor proven. In heldTasks worktree, project return and journal authorship kept, polling replaced with a settlement event; the visitor-delete success-only smoke removed. Ledger x10/x-threads.tsv updated; watch duty stays a separate task.
