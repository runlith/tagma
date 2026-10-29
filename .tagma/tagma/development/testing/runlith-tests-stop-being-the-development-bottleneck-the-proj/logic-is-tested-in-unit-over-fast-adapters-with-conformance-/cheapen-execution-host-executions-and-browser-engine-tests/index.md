---
id: 01a16dee-87a0-7341-a7e3-556ec3b7d61e
title: Cheapen execution-host, executions and browser-engine tests
ord: 11
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16dee-2ab6-7368-a8dd-8e28322636c7",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16b01-cb85-7e31-9936-47664dbd9a84
---
Finished part of x-exec-b: duplicate browser engine files and one CPU hang removed, browser/cast/cookies and host recovery merged; tempo contracts keep their own process outside the external host tree, while the contract host uses the shared bundle's JS and the same cache as the CLI. For changed files historic sum 142.2 s CPU → 88.0 s in separate runs under load (1.62x ratio of sums); this is not a whole-package measurement, source tempo runs were red, the shared bundle after is paid on every separate run. The −91% goal is not reached by this part; the final result is the quiet full run. All changed tests green on seeds 1–3, package typecheck green. Remaining root/posix and composition files handed to other delivery tasks. Details and commits — x10/x-exec-b.tsv.
