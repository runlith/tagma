---
id: 01a16494-43ef-7084-87a4-42aed99f29de
title: Merge carries a branch's ordinary debt into a file clean in the base
ord: 34
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16491-7637-7c13-8ac1-a8e03930f9c1",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16491-3485-72d0-828b-01e9d7c9afe2
---
Remove merge_worktree's dependence on whether remeasure turned absorbed held debt into ordinary debt in time: merge is judged against main, and the inspection ignores ordinary debt in an existing clean base file. Carrying an accepted violation of the branch must pass; a returning vanished violation and a new fingerprint must still refuse. The public scenario with enforce_rule without absorb after submit reproduced the merge refusal in 26.10 s; a git show of the rule card in the HEAD worktree confirmed the accepted fingerprint without held, escape empty. The fix passes the source tip as a separate base for accepted-debt confirmation only. After the fix, the units/sites boundary in `2095e55976`: the final public native scenario with two places of one accepted unit green — 22 assertions, 18.49 s; a committed fingerprint outside debt refused the merge, accepted ordinary debt arrived in main. Existing checks: several parents — 2 pass; program units — 13 pass; counted program judgement — 2 pass. Final `bun run typecheck` green, server — 5437 files. Stale debt and count-growth are protected by source-without-debt reading and the count ceiling, not verified by separate runs; freshness unchanged.
