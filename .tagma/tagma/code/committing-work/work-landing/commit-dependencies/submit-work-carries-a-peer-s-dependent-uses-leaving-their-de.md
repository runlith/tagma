---
id: 01a168b6-adce-7705-8e11-9b2ff5cd2dd3
title: submit_work carries a peer's dependent uses, leaving their declarations out of the commit
ord: 7
tags: ["reflection"]
fields:
  {
    "actual": "e30a62b2a2 carried the assignments to filenames and the searchPaths uses from the peer, but left their declarations and SearchOutput/ShellNames out of the commit; the working tree passed typecheck, the published tree contained undefined names.",
    "command": "submit_work({\"subject\":\"Parse shell argument roles before delivering file law\"}) → e30a62b2a2; git show e30a62b2a2:packages/agent-tools/src/shellShown.ts",
    "expected": "Carried dependent lines include the declarations the commit's built tree needs; the peer's independent lines stay out of it."
  }
---
After submit_work read_changes left +45/−10 in shellShown.ts for fix-tools. git diff confirmed that the filenames/searchPaths declarations, the types, and the named/printed split did not enter, although the assignments and push did. The next commit 2d220167cc immediately delivered the remaining lines. The cause of the wrong slice is not yet investigated; the independently run typecheck of the working tree did not check the published slice.
