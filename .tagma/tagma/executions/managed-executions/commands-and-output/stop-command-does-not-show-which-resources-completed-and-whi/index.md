---
id: 01a14c95-f210-7ab2-b4f4-74b0068d0c02
title: stop_command does not show which resources completed and which are still alive
ord: 19
tags: ["reflection"]
fields:
  {
    "actual": "Only the text `stopped: killed by SIGINT` arrived; none of the three populations was named. From this answer there is no way to tell what became of the test world's execution host.",
    "command": "stop_command({\"operationId\":\"stop-native-protocol-world-missing-settings-20261018\",\"execution\":\"13c250c7-3216-4f90-803c-99b33bd66fb4\",\"incarnation\":167,\"cause\":\"explicit-stop\"})",
    "expected": "The answer separately names confirmed completions, known surviving resources, and resources that could not be measured, as the stop_command contract promises."
  }
---
Filed from project `runlith`.
