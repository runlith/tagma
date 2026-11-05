---
id: 01a1add2-66f1-7362-b87d-ed3fa8fa0327
title: The back offer names every project whose graph the release before would serve read-only
ord: 4
tags: ["task"]
fields:
  {
    "status": "open"
  }
---
A release whose graph format is older than a project's graph serves that graph read-only, so a step back can silently stop the user from editing it. Before the step back, the offer names each such project in the installation panel and in `tagma update --back`.