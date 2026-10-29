---
id: 01a12af0-e0b6-7515-b6a0-30475ed0e868
title: submit_work again reports landed files as uncommitted with a clean tree and index
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "Listed 10 files (including the 4 just committed) as 'lines of this session still stand uncommitted'; `git diff HEAD --stat` and `git diff --cached --stat` were empty right after.",
    "command": "submit_work paths=[4 files] whole=true → e2612060ed",
    "expected": "No 'still stand uncommitted' lines when git diff HEAD and git diff --cached are both empty"
  }
---
Filed from project `runlith`.