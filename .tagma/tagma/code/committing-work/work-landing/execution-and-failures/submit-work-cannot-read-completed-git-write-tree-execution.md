---
id: 01a0e87c-4cf9-71f5-b140-771283945df2
title: submit_work cannot read completed git write-tree execution
ord: 16
tags: ["reflection"]
fields:
  {
    "actual": "Refused: nothing committed. git write-tree ended but its console could not be read: terminal-host-refused-UnknownExecution, host holds no execution under that reference. The prescribed recovery read_terminals for this thread reports no terminals held. No git failure output was available.",
    "command": "submit_work(subject='Separate machine registry from graph policy', taking=['registry-fixtures'])",
    "expected": "Commit the held projects registry slice and stopped helper's fixture edits, or return a git/rule refusal with usable recovery."
  }
---
Filed from project `runlith`.

This is a command-host execution custody/read failure during submit_work, not a graph rule violation or a failing git write-tree exit status. The tool said to read terminal list again and start a new execution because the previous execution is over.