---
id: 01a16df9-0584-701b-9d27-4814c8299e01
title: Git fsmonitor hides a deletion from the change record and submit_work
ord: 17
tags: ["reflection"]
fields:
  {
    "actual": "delete answered 2 removed; plain git status/diff and the change record lost the deletions, submit_work with explicit paths skipped them. git -c core.fsmonitor=false status showed both D, after which the repeated submit_work landed both paths.",
    "command": "delete({args:['--','apps/tagma/server/src/composition/testing/http/doorFixture.itest.ts','apps/tagma/server/src/composition/testing/http/doorWorldHosts.itest.ts'],workdir:'/opt/workspaces/runlith'})",
    "expected": "A deletion stays the current session's change until submit_work; explicit paths include deleted files even with stale Git fsmonitor state."
  }
---
Bytes were never restored: the repeated delete refused not-found, though plain git status/diff on the paths were empty and read_changes marked both edits withdrawn (reverted). The explicit submit_work skipped them saying the paths name no file this session holds. One `git -c core.fsmonitor=false status --short --` on the exact paths showed both D; read_changes then saw nobody −44, and the next submit_work with the same paths landed both deletions in commit 9fbea6054b. git ls-files after the commit did not return these paths. HEAD moved under foreign commits; the source of the false clean answer is Git fsmonitor state, not a proven file restore.
