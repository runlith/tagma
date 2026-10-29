---
id: 01a1616b-1dba-7a06-8b59-34f4b4e7efac
title: Bun macro import counted as a runtime dependency by code-facts
ord: 12
tags: ["reflection"]
fields:
  {
    "actual": "The runtime platforms gate follows ruleSignatures imported with { type: 'macro' } into declaration-generation code and reports its build-time schema imports as runtime violations.",
    "command": "submit_work {subject: \"Describe inspection calls from SDK declarations\"}",
    "expected": "A Bun import with { type: 'macro' } is a build-time dependency and is excluded from runtime load closures; modules still sees its dependency."
  }
---
Filed from project `runlith`.