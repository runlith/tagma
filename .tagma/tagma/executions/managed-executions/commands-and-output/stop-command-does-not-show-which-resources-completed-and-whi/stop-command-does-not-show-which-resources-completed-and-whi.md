---
id: 01a14c97-4128-7918-80b2-39ed201aac69
title: stop_command does not show which resources completed and which are still alive
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "The Whole/Settled answer carried only the key and the execution; the stop result itself and the resource populations are missing. A recovery read cannot establish the execution host's state either.",
    "command": "read_terminal_operation({\"operationId\":\"stop-native-protocol-world-missing-settings-20261018\"})",
    "expected": "Reading the same operationId returns the full stop result already received, with confirmed completions, survivors, and unmeasured resources."
  }
---
Filed from project `runlith`.
