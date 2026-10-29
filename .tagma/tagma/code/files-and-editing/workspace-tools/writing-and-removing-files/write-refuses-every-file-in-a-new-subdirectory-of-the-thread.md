---
id: 01a12b2b-fbd8-7905-8c54-8db3dcbb338d
title: "write refuses every file in a new subdirectory of the thread's own scratch: \"cannot be established as the resource this call was allowed over\""
ord: 5
tags: ["reflection"]
fields:
  {
    "actual": "Every call refused with \"cannot be established as the resource this call was allowed over. Call it again so it is resolved and allowed together.\"; a retry refused identically. A write to a file directly in the scratch root succeeded. Fixture was built with one bash command instead; cost 8 refused calls.",
    "command": "write {path: \"~/.tagma/scratch/01a12b12-a3a2-7e2c-b91a-997500c6640b/ws/package.json\", content: \"...\"} (and 6 more files under ws/packages/*), then the same call again alone",
    "expected": "The file is created in the thread's scratch with its parent directories, as write does in the checkout."
  }
---
Filed from project `runlith`.