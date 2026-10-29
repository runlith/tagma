---
id: 01a12d35-169c-70c9-a5de-4dade64d41ec
title: "A reflection that no longer reproduces can only stay open: answer_reflection accepts finished work or a fixing commit, nothing else"
ord: 2
tags: ["reflection"]
fields:
  {
    "actual": "answer_reflection accepts only a finished task or a fixing commit; the agent could only append the check into the body. The entry stays in the unanswered list beside live defects.",
    "command": "answer_reflection on 560a23b2 after an agent verified on current code that CLI and native read_inspections answer the same 10 measured rules",
    "expected": "One act closes the reflection as checked-and-not-reproducing, carrying the date, build and conditions checked, so it leaves read_reflections and can be reopened on a new sighting"
  }
---
Filed from project `runlith`.

In one sweep of 96 reflections at least ten ended this way (56e7305b, caaa77ec, cb5bf93d, ef21c1ec, f5bacc7b, e9f93dfe, 45ed43fe, f86551ab, 3df08a75, 560a23b2), and others are answered "by design" (0da4b4f7, f564b376). The unanswered list stops meaning "open defects", and every later reader re-triages the same entries.