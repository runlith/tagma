---
id: 01a16bf7-ee7b-7577-820a-939bcb938ed5
title: A tracked file removed with the delete tool is not held, and submit_work with that path answers "nothing to commit" while git's fsmonitor misses the deletion
ord: 98
tags: ["reflection"]
fields:
  {
    "actual": "The preceding submit_work without paths landed 36 files but not the deletion; submit_work with the path answered \"nothing to commit — `paths` named no file this session holds\"; read_changes: \"No judged path stands under …\". `git status` (core.fsmonitor=true) showed nothing, `git -c core.fsmonitor=false status` showed \" D\". It landed only after touch_path {as:\"wrote\"}, in d68c04e688.",
    "command": "delete {args:[\"/opt/workspaces/runlith/apps/tagma/server/src/enforcement/drives.ts\", …]} then submit_work {paths:[\"apps/tagma/server/src/enforcement/drives.ts\"]}",
    "expected": "The delete tool records the removal of a tracked file as this session's, and submit_work (with or without paths) lands the deletion."
  }
---
Filed from project `runlith`.

The file had been created by `write` and landed in d1dc22df17 earlier in the same session, then removed with `delete` (answer: "2 removed"). The checkout runs git with `core.fsmonitor=true`; the deletion never reached plain `git status`, so the explicit-paths selection ("changed files and deletions nobody holds") found nothing either. Cost: three extra calls and a dead file standing in HEAD between commits.