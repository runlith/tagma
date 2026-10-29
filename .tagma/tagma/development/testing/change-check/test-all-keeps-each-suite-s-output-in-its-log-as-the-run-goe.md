---
id: 01a17b25-8949-7a70-842c-d180fb402d37
title: test:all keeps each suite's output in its .log as the run goes
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17b24-9272-7cca-931d-aebeca364a5a",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a17b24-1e43-7bd8-afd2-ffd633da0e52
---
Write each suite's stdout and stderr to its .log before the process ends, so stopping the command keeps the errors already printed. Check through bun run test:all on a synthetic repository, interrupting the run once an observed fact says so — no deadline, no sleep.
