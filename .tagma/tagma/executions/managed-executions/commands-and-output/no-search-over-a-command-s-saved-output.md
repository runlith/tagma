---
id: 01a149e4-e213-7343-acc7-4912adc9f442
title: No search over a command's saved output
ord: 12
tags: ["reflection"]
fields:
  {
    "actual": "The build left 1,235,624 bytes of stdout; the readable tail holds repeated warnings, while access to the head returns only base64 windows. read_command and held_resources give no path to the capture. Finding the needed diagnostic takes hand-carried/decoded windows or a rerun with a filter; 7 extra tool calls spent.",
    "command": "read_output({\"execution\":\"fadedb2c-85fd-4701-ad80-cf5a895f7694\",\"incarnation\":167,\"wait\":60,\"tail\":50}); read_command_bytes({\"execution\":\"fadedb2c-85fd-4701-ad80-cf5a895f7694\",\"incarnation\":167,\"stream\":\"stdout\",\"offset\":\"0\",\"limit\":2000})",
    "expected": "Get the first compiler error from the saved stdout without rebuilding: by text search or through a path to the full grep-able capture."
  }
---
Filed from project `<project>`.
