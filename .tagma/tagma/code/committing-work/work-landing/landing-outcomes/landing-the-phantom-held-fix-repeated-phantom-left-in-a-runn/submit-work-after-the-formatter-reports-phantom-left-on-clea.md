---
id: 01a12b05-8267-7375-b384-0cfb767efcb5
title: submit_work after the formatter reports phantom-left on cleanly landed files
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "Commit 9e883ec54d landed 40 paths, but the answer named CollaborationTools.test.ts, treeActs.ts and ThreadHosting.ts as remaining uncommitted. The next read_changes showed holds 0; git diff across all three is empty. Verifying the false left took two reads.",
    "command": "submit_work({subject:\"Fix collaboration addresses, live model moves and refusals\",whole:true})",
    "expected": "After the commit and the commit steps, left holds only the session's lines that actually remain."
  }
---
Filed from project `runlith`.
