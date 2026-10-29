---
id: 01a12863-bb0b-7715-800b-75f8f5bacc7b
title: "A child agent's bash loses a large git diff: the execution host stops delivering state"
ord: 12
tags: ["reflection"]
fields:
  {
    "actual": "\"The execution host could not answer … state stopped arriving … Whether it finished is not known\", three times, twice with no output; the parent's same diff written to a file worked at once",
    "command": "bash: git diff over a range of ~103 commits (1051 files) at a child code agent",
    "expected": "The command returns the output tail or plainly says it hit the limit"
  }
---
Filed from project `runlith`.
