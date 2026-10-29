---
id: 01a1321d-89bb-71ad-9fc2-e79213a6bba3
title: submit_work never carries the source deletion of a git-mv'd file, so a move cannot land
ord: 82
tags: ["reflection"]
fields:
  {
    "actual": "read_changes shows the new path as \"(from old)\" held by the session, but the judged tree keeps the old file at the old path, so rules fail on its dangling imports (13–21 crossings of 083d37f1). With whole=true only paths recorded as \"unattributed overlap\" are deleted; files held as \"renamed from\" keep their old copy. check_rules naming only the old paths answers \"this session holds nothing the branch does not already carry\". The joint landing with taking=[mask-boundary, sub-split], whole=true was refused the same way (74 crossings). The direct `git commit` fallback then needs an approver this run cannot get (no-approver). Cost: about 1.5 h with three agents blocked on one landing.",
    "command": "submit_work(paths=[new and old paths of ~25 git-mv'd files], whole=false and again whole=true); check_rules over change naming only the old paths",
    "expected": "A file this session moved lands as a move: the new path added and the old path deleted in the same commit, whichever of the two paths is named."
  }
---
Filed from project `runlith`.

runlith, task 966f82e9 (mask-boundary) jointly with 37f9b119 (sub-split). The moves were made with `git mv` so authorship stays; the index holds them as staged renames (R/RM). Possibly related: a5ecf3a0.