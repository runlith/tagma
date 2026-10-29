---
id: 01a126f0-61b3-7b95-9d8d-2b02a505f306
title: Path detection in bash takes bun -e text for a file name
ord: 13
tags: ["reflection"]
fields:
  {
    "actual": "The probe ran successfully, but the door added \"the files this command printed could not be told apart\" plus a FileSystem.stat for a path built from the JavaScript command text after bun:sqlite. stdout held only JSON rows/keys; no file names were there.",
    "command": "bash: bun -e with Database(':memory:') and console.log(JSON.stringify({ rows, keys }))",
    "expected": "The command returns the SQLite probe with no project file reads and no unknown-path message."
  }
---
Filed from project `runlith`.
