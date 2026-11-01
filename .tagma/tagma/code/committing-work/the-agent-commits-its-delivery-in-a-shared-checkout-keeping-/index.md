---
id: 01a14c13-c481-7acc-8aa6-03b854ec4a27
title: The agent commits its delivery in a shared checkout, keeping authors and task names
ord: 1
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03b329e7e083
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03b9332b5b81
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03ba0a234a8f
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03bbcfdb998e
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03c6a28ec4cb
sources:
  - kind: file
    ref: apps/tagma/server/src/landing/land/message.ts
  - kind: file
    ref: apps/tagma/server/src/landing/land/submit.ts
  - kind: file
    ref: apps/tagma/server/src/landing/operations/submit.ts
  - kind: file
    ref: apps/tagma/server/src/landing/voice.ts
  - kind: symbol
    ref: apps/tagma/server/src/landing/contract/wire/operations.ts
    symbol: LANDING_OPERATIONS
---
**Value.** Several agents write into one tree, and each lands its own work in one call: hand-written files split by authors, program-written ones keep whole state.

**How.** The `submit_work` tool and operation (shell capability, only in a shared checkout with history).

**Behaviour.**
- Without parameters the commit takes what accounting holds for the session in the selected checkout; `paths` adds changed paths, including nobody's; `whole` sets files or directories among the selected paths that land as they stand, with others' lines and author names. A session with lines in several checkouts commits into each with a separate call.
- Independent neighbouring edits of an ordinary file land separately; dependent insertions and replacements go together with authors, while the operator's lines require explicit taking. Whole command rewrites without file-tool history and `linguist-generated` files land whole and name other holders in `carried`; `linguist-generated=false` permits ordinary splitting. Program-origin content carried beside excluded working changes needs caller `derive` commands or matching config declarations; these regenerate outputs over committed inputs without rewriting working outputs or changing recorded holders.
- A move lands as a pair; an open merge with a resolved index lands as a merge commit together with the session's lines.
- `taking` picks the named holder's work. For an idle agent session no extra consent is needed; a working session raises `still-running`, the operator's lines `lines-of-another`, and the question is decided by the call mode.
- Before publication, the commit passes commit steps, repository hooks, and the rules court (A4); a gated-rule violation on its own lines and automatically taken dependencies refuses in any mode.
- The caller declares in `tasks` whose tasks' work the commit carries; each must be theirs or a `taking` holder's. Only these land in the commit, one `Task: <name> <title>` trailer each, and are attributed in the answer; the subject and the separate `body` stay the caller's words. Without a subject, the single declared own task's title is used. Without `tasks`, tasks aren't attributed, and the answer separately lists the session's held tasks as unattributed; `tasks: []` explicitly switches that reminder off. The branch moves only compare-and-set: on a moved HEAD the ready tree is re-laid and judged anew.
- The commit — like each merge or squash commit `merge_worktree` assembles — carries `Co-authored-by: Tagma <agent@tagma.dev>` unless the `commits.coAuthor` setting is off; all trailers stand in one block after a blank line, joining one the body already ends with. Author, committer and signature stay the user's.
- The answer names the commit, paths where the caller's or taken holders' lines still stand, selected paths with unowned lines left on disk, and paths its commands changed beside others' that nobody took. If the commit changes an enforced-inspection description, `rechecked` names the new description's findings outside debt across the rule's whole reach.
- Stopping the call after publication keeps the commit in read-back by holder and call key. Unfinished index updates, hooks, line accounting, post-landing checks, and task reading are named in `unrecorded`; missing publication confirmation leaves the outcome unknown. A finished receipt keeps the full answer, including tasks.
- Declared tasks in the answer come with the holder, how their lines arrived, and, where the holder's threads know, with the foreign holder's state (working, idle, failed, vanished). Landing doesn't close them: whoever landed finishes completed tasks through finish_block with that commit.

**Limits.** A running cherry-pick, revert, rebase, or am must finish before landing. The graph store isn't in the commit — the graph itself commits it (A4). A commit without steps is only on the operator's word.
