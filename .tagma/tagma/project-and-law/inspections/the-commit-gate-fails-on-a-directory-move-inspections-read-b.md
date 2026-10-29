---
id: 01a12b5a-2590-770f-91a0-ec8ac687c34e
title: "The commit gate fails on a directory move: inspections read binary and non-module files as sources"
ord: 52
tags: ["reflection"]
fields:
  {
    "actual": "submit_work: the oxfmt commit step \"deleted\" 129 files under apps/tagma/app/src/lib/features/checkout/* and the commit was refused. git commit: inspection-failed on 6 rules — apps/tagma/app/static/apple-touch-icon.png \"is not UTF-8 text\" (083d37f1, 50520d64, 6b3210c7, 55b5437b, d81b1676) and apps/tagma/server/workflows/document-edit.js \"does not parse: return outside function\" (8183e6ef). No road commits a move without passing hooks.",
    "command": "submit_work after moving 9438 files, then git commit",
    "expected": "The move commits; inspections judge only files of their extensions at the new paths."
  }
---
Filed from project `runlith`.
