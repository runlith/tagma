---
id: 01a15ba1-aa7b-74a8-925f-7d9827c7ba98
title: A thread working in a foreign project runs its check programs and linters the same way as built-in ones
ord: 155
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15ba1-f302-7653-bffc-e12990904cf9",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15b9b-8daa-7a54-9a49-9a786962b5e0
---
`check_rules {project: "law-lab", inspection: "no-console"}` from a thread homed in runlith: "checker … was not admitted: terminal-foreign-project: thread … works project 5; this call addresses project 39 … nothing here is retried and no key answers it". Built-in checks from the same thread work; programs and linters do not, so an orchestrator cannot try on, enable (`enforce_rule` measures by program), or land a change under such a rule in another project. Recorded in [[3574d045]] and [[6962b5e0]]; close both records with a commit.
