---
id: 01a13d1f-7ad4-7984-8a65-80961f914bf1
title: bash `echo` answered with an undecided host outcome
ord: 10
tags: ["reflection"]
fields:
  {
    "actual": "Empty output plus \"The execution host could not answer for this command: the state of this command stopped arriving before it was decided: its subscription ended completed\" — whether it finished is reported unknown.",
    "command": "bash {command: \"echo\", description: \"noop\"}",
    "expected": "A trivial command runs and answers its empty output with exit 0."
  }
---
Filed from project `runlith`.

Operation toolu_017jNHpVv5FXLsUKrtZMkMRM:36d10524-4506-4573-8b8a-cc74aaa57f73, execution 67e30e46-143a-4729-9697-90a997dfd5e9. Ran in parallel with a check_law over all. Cost: none here, but any command whose result matters would have had to be rerun blind.