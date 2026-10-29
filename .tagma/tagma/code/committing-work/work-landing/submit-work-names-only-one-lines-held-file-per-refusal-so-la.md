---
id: 01a15018-9312-7d2f-8f3c-56cf0e9e270d
title: submit_work names only one lines-held file per refusal, so landing around interleaved peers takes one round trip per file
ord: 63
tags: ["reflection"]
fields:
  {
    "actual": "Each refusal names a single path (Root.svelte, then artifactLinks.ts, ProjectCreation.svelte.ts, Admitted.svelte, mobile/Shell.svelte…); five full submit_work calls with the 85-path list so far and still no landing",
    "command": "submit_work(paths: [~85 held paths]) in /opt/workspaces/runlith with two peer sessions holding lines beside mine in ~20 files",
    "expected": "One refusal listing every path whose carried regions hold peer lines, so the caller can exclude them all in one retry"
  }
---
Filed from project `runlith`.

read_changes already knows which held paths have peers "beside"; the lines-held judgement is computed per path, so collecting all offenders before refusing looks cheap. Workaround used: exclude every path read_changes lists with a peer beside, in one go.