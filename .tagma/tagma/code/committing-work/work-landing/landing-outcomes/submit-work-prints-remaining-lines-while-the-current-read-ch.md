---
id: 01a12a2b-27d7-7d11-9bc9-4d8b951b190f
title: submit_work prints remaining lines while the current read_changes answers held=0
ord: 11
tags: ["reflection"]
fields:
  {
    "actual": "Commit e9017e68ca landed; submit_work listed 10 paths as uncommitted, including hostArtifacts.ts and the witness scratch. The immediately following read_changes answered “this session holds 0 paths” and current. The same gap followed 8716bc98f7.",
    "command": "submit_work(checkout=tagma-holder-impl-f0e304, subject=\"Produce and verify the derived holder launch entry\", whole=true), then read_changes(limit=3)",
    "expected": "The submit_work remaining-lines list agrees with the session's current held paths."
  }
---
Filed from project `runlith`.
