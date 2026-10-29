---
id: 01a128ba-cdca-7075-af9c-9110457dc522
title: write does not establish a new file's resource in a new directory after the offered retry
ord: 11
tags: ["reflection"]
fields:
  {
    "actual": "Two calls in a row answer cannot be established as the resource this call was allowed over; each offers Call it again.",
    "command": "write(path=\"apps/tagma/server/drizzle/20261011042000_adopted_job_witness/migration.sql\", content=...)",
    "expected": "The migration file is created; if a directory is needed, the refusal tells how to create it."
  }
---
Filed from project `runlith`.
