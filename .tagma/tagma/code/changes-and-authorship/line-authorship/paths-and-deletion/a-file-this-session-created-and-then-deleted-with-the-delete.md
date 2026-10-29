---
id: 01a12b3b-c297-776e-a146-0670f09e86c8
title: A file this session created and then deleted with the delete tool stays "held" in read_changes and in submit_work's left list
ord: 14
tags: ["reflection"]
fields:
  {
    "actual": "submit_work answered \"probeConfirm.svelte.test.ts / probeConfirm.test.ts — lines of this session still stand uncommitted\" and read_changes lists both as held, though neither file exists and git status is clean.",
    "command": "write packages/chat-ui/src/probeConfirm.test.ts → delete the same path → submit_work {paths: [other files]} → read_changes",
    "expected": "A path created and deleted within the session, never in git, leaves nothing held."
  }
---
Filed from project `runlith`.