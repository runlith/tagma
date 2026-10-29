---
id: 01a12821-914e-7e48-bce9-de60f86551ab
title: submit_work whole skips its own generator's files without held lines
ord: 7
tags: ["reflection"]
fields:
  {
    "actual": "Commit 04585e3984 took 64 of 81 paths; it skipped 17 as “paths named no file this session holds”. git diff shows my spread replacements, read_changes on SelectionRepo.ts answers “Nobody holds uncommitted lines”.",
    "command": "submit_work whole:true with exact paths changed by clean.ts --apply in optional-fields",
    "expected": "All named changed files enter whole, as the bash answer about overlap advised: “land them with submit_work whole: true”."
  }
---
