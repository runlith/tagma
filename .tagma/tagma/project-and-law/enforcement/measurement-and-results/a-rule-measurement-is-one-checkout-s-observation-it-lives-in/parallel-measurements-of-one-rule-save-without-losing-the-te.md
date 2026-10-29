---
id: 01a16545-98bf-73cc-96b1-b628381d0135
title: Parallel measurements of one rule save without losing the temp file
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16545-34c4-707b-b492-1afa9a19a49c",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16545-0741-76a6-9713-f83109a56cb9
---
Remove the temp-file collision when parallel measurements of one rule write in one checkout. Cause confirmed: two passes with one pid and millisecond share a staging path, the first rename takes the second's file. The producer now picks a UUID for every publication. A real-disk owner test and the original native absorb/submit/merge scenario reproduced ENOENT before the fix; after it — 2 pass, 18 assertions, system 31.44 s and owner 0.59 s. The native thread stands in home, acts over another project and its linked worktree; debt reads after merge, observation integrity is checked by the owner test. A full server typecheck before the trivial staging-identity swap is confirmed by an applicable peer check: 5,465 files with no errors; no wide rerun started. An independent [[01a1655b-f74d-7e62-a87a-1d6ecbd5ff20|delivery review]] found no findings and confirmed the native regression matches the original report.
