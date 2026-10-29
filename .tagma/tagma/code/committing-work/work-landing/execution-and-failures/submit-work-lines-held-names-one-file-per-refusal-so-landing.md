---
id: 01a15020-b94e-70ba-b09d-b86f0d905e85
title: submit_work lines-held names one file per refusal, so landing past several interleaved files takes one full call per file
ord: 17
tags: ["reflection"]
fields:
  {
    "actual": "Each refusal names only the first such path (Root.svelte, then artifactLinks.ts, then runtime.ts, then PairForm.svelte …); every retry resends the whole 75-path list to learn the next one",
    "command": "submit_work(paths: [75 paths]) in /opt/workspaces/runlith with two live peer sessions holding lines in ~20 of those files",
    "expected": "One refusal naming every path whose regions carry another holder's lines, so the caller drops or carries them all in one changed call"
  }
---
Filed from project `runlith`.

Seen landing task 09386eb6 beside refactor-bridge and refactor-rest. Four consecutive refusals so far, each a full submit_work with the commit steps' preflight; the set of interleaved files was knowable on the first call. read_changes' `beside` marks files with peer lines but not whether they fall inside the regions the landing would carry, so it cannot substitute.