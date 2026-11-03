---
id: 01a1a25c-6fca-7c0f-9fe8-83ccae0ae3df
title: A release start and an install take turns on install.lock, and a start of a third release refuses while an update stands open
ord: 71
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a1d9-8e94-7b5b-8188-aa7a75a98d69",
    "status": "in_work"
  }
---
`install-from` held `install.lock`, while `Trial.arrive`, `enterTrial`, `passed` and the rollback did not: a release starting during an install could migrate and pass after the installer had already chosen its `from`, so a later rollback put that release's data under a `from` that cannot read it. Every read and write of the attempt record and of `current` goes under the lock, and while an update stands open only its `to` (as `current`) and its `from` open the data.