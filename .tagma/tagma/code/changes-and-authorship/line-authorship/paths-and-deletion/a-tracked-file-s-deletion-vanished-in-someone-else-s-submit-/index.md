---
id: 01a16df3-5a0a-7f0b-a8c0-3af856abb20f
title: A tracked file's deletion vanished in someone else's submit_work
ord: 19
tags: ["reflection"]
fields:
  {
    "actual": "delete answered '1 removed'; after three checks the file matched HEAD again, git status was empty, read_changes showed withdrawn (reverted).",
    "command": "delete({args:[\"--\",\"apps/tagma/server/src/installation/closure/workers.itest.ts\"]})",
    "expected": "A successful deletion stays this session's change until its submit_work and is never restored by someone else's commit."
  }
---
Checkout /opt/workspaces/runlith. The deletion ran in thread 01a16dee-7f91-7937-b301-822b352f805d; then one bash checked only closure/read.itest.ts with seeds 1/2/3, all 11 tests passing in each run (~17 s wall). In that window HEAD moved a466c0e44 → e91ab5c43 → 1d6983188. No command of this session restores workers.itest.ts. `git log -3 --` on the file showed only the historical 258c23c80b; `git ls-files -v` printed H. read_changes: holds 0, lines that left reverted 1.
