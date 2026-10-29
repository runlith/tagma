---
id: 01a176f5-968e-7130-8341-bc0eec3fcd40
title: A finished command loses access to its output before the first read
ord: 18
tags: ["reflection"]
fields:
  {
    "actual": "read_output answered ended, exit 0, with \"its output is no longer kept on this host\"; search_output on another just-finished command refused terminal-host-refused-HostConflict: RecordReadFailed. The output of three seed checks stayed unavailable.",
    "command": "read_output({execution:\"2af70f50-fade-4d2f-af21-41edca2cad4c\",incarnation:167,tail:60}); search_output({execution:\"da423d0a-1fd3-47cd-9e78-62c2230cc454\",incarnation:167,pattern:\"counts|selected|changed|files|unsupported\",before:2,after:4,limit:20})",
    "expected": "The first read of a finished command returns the saved output; searching a finished command reads the same buffer."
  }
---
Filed from project `runlith`.
