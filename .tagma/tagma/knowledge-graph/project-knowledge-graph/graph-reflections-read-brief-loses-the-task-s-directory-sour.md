---
id: 01a13f63-559c-7cb3-89b6-c44499eae732
title: "Graph reflections: read_brief loses the task's directory sources, grandchild read_block, slow edit_block"
ord: 50
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f64-c078-735f-9b04-6fb78e3ef643",
    "status": "done"
  }
---
Fix the obvious defects from the reflections at the root:
- [[0434192d]] and [[05feb760]] (with sub-records, 8 sightings): the task brief says "The task names no code" while the task carries directory sources.
- [[45ed43fe]]: a grandchild agent's read_block refuses over runlith block ids its parent reads.
- [[ac005006]]: edit_block on a large block takes 36–46 s and grows with every edit.

First check whether each reproduces on the current code. An item whose fix needs a product decision is not done but named in the report. Proof is a contract test where one exists and a landed commit; fixed reflections are answered through answer_reflection.

Done: the brief accounts for directory sources and keeps symbol; the task itself is excluded in Sources.ownersOf before ranking, so a subdirectory source never displaces the module. The original defect is confirmed red→green; after one review round (Sol xhigh and two Muse lenses) 6 briefs/sourcesPlaces integration tests passed, 33 assertions. diff --check is clean. Shared-tree typecheck failed: 9 errors in others' graphFixture.ts, native-harness/graphFiles.itest.ts, graphTools.itest.ts, and enforcement/voice.test.ts; it reported no errors in the changed production files. Delivery is 9d0b55d0a3 and 30abc9c7fb; eight directory-sources records were answered by the first commit, the second removes the review-confirmed subdir and symbol edges.

Not fixed: [[45ed43fe|grandchild read refusal]] — the current grandchild in main reads the original aa1b0681 without project and all four reflections with an explicit project successfully; the historical parent→child→grandchild in restructure did not reproduce, its root and fixing commit are not established. [[ac005006|edit_block cost growth]] — on 800d18e1dc-dirty four consecutive Blocks.edit calls with a new 177016-character body took 230, 431, 273, and 154 ms; content verified after each. That is an owner/SQLite scenario without tree projection and long history, not a reproduction of the earlier ~15-agent load. The cause of the 36–46 s is not established; the open investigation [[3751ed77|edit cost]] stands. The operator's server was not restarted.
