---
id: 01a12c8a-b8b4-7948-a37d-ecee0de789c6
title: submit_work answers `left` with the Holdings judgement projection, not with the record lines' state
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12c86-94f7-747f-9d9d-8b4c7b522a9e",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1284c-fa45-7a15-b073-dc74e8abf3bc
---
`left` in the `submit_work` receipt derives from `workspace_change.state = 'held'` (`pathsOfThread`), while `read_changes` answers the same fact — which paths the session still holds — with the Holdings judgement. A record line stays `held` until retirement proves it out (an open command window delays the exit, a line with unchanged head is kept for stash, non-git files are revoked only at an archived thread), so the receipt named paths where no session lines stand anymore. The same state-derived answer is the `held` state in `turns` of `read_changes`.

Do: `left` — paths where the Holdings judgement after landing names an arm of one of the carriers (or unproven with one among the writers), except non-git paths; candidates — leased paths and post-landing lines, judgement — one `judged` call that discharge already makes. `turns` take `held` from the same owner projection.

Done when a contract itest shows an empty `left` on a path that returned to HEAD with a standing record line, and a `left` with a genuinely remaining path; Sol xhigh review + lenses; landing.
