---
id: 01a16514-78c6-7b6d-8a95-078306c93469
title: save_agent with sourceFile answers success with the former revision and does not write the edited file
ord: 42
tags: ["reflection"]
fields:
  {
    "actual": "Answer successful, but with the former revision 0d300cbb… and former text; agents/secretary.md unedited. The same text passed through source recorded at once (revision cfb7ed17…)",
    "command": "save_agent {name: \"secretary\", scope: \"personal\", revision: \"0d300cbb…\", sourceFile: \"~/.tagma-dev/scratch/01a163ff-c890-77a1-9b13-0d3a3d0c9c2/secretary/secretary.md\"} after editing this file",
    "expected": "The definition recorded from the file's current contents, the answer carries the new revision"
  }
---
Filed from project `runlith`.

The file in scratch changed through `edit`, and after that `read` and `grep` show the new line 28 in it ("A turn his own words opened is his conversation…"). The first save of the same file was in this same thread around 19:30 with `revision: null`. Looks like `sourceFile` is read from cache or from the first read's snapshot, not at call time, though the description promises "read at call time". That is a conclusion, I did not check the cache. Cost of the error: the answer looks successful, and the change is silently lost.
