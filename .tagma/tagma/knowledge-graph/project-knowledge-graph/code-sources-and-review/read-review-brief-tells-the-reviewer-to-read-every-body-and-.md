---
id: 01a14e11-d5ff-7917-ab0f-4e54a874fdc9
title: read_review_brief tells the reviewer to read every body and every source whole, which does not fit a large code diff
ord: 13
tags: ["reflection"]
fields:
  {
    "actual": "The brief says to read EVERY body and EVERY source whole before the first finding; the reviewer (gpt-6.1-sol xhigh) read for several passes, reported it cannot fit the full reading in context and needed the launcher to relax the rule twice",
    "command": "read_review_brief scopeId=bdb21bcd (task with two directory sources), lens, name, notes",
    "expected": "A brief that scopes the reviewer to the changed files and their call chains when the sources are directories and the change is ~51k diff lines"
  }
---
Filed from project `runlith`.