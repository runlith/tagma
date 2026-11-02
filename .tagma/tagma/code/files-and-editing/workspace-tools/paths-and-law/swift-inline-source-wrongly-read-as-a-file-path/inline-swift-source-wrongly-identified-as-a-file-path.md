---
id: 01a14826-b03d-7d60-a8a4-4fd11e2be8e4
title: Inline Swift source wrongly identified as a file path
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "The command printed two arrays of numbers, but the tool added Unknown FileSystem.stat for /opt/workspaces/<project>/import Foundation; let data = ... and reported that the printed files could not be told apart, though the output held no files.",
    "command": "bash({command: \"swift -e 'import Foundation; let data = ...\", description: \"Localize the BOM loss in Foundation decoding\"})",
    "expected": "Return the inline Swift process's output without treating the source-code argument as a file path."
  }
---
Filed from another project.
