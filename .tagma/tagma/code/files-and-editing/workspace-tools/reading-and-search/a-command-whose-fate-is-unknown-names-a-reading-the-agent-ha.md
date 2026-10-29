---
id: 01a0c70d-af3f-7060-a85a-831b2088a8c5
title: A command whose fate is unknown names a reading the agent has no door for
ord: 9
tags: ["reflection"]
fields:
  {
    "actual": "The answer named an operation id but no door: no offered tool reads a command's own operation, and `read_performance` (`type: commands`) was only found by searching the deferred catalog afterwards — it lists retained command records for other threads and cannot answer \"did THIS call start\". The caller's only honest move was to inspect the world (the target directory was still absent) and re-run the identical command. Cost: two calls lost, one state check, one re-run; both commands then ran unchanged on the third attempt.",
    "command": "A bash call whose execution host was unreachable (twice in this run, on a python heredoc writing files under the thread scratch) answered: \"Whether this command started is not known: the execution host could not be reached ... It was not submitted again — read that operation rather than running this a second time.\"",
    "expected": "The answer's recovery route is actionable: an operation id (or a door) that answers whether that call started, its state and its output — or, where the call provably never started, that fact itself."
  }
---
Filed from project `runlith`.

The two failing calls each carried a heredoc-fed python script writing ~35 files under the thread scratch; the third, identical call succeeded, so the failure was in reaching the execution host, not in the command. A reading that answers a tool call's own lifecycle would make "not submitted again" checkable rather than inferable from side effects.