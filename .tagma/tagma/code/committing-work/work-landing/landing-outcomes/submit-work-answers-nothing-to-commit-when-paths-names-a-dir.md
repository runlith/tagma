---
id: 01a0c891-4c29-7633-b4af-e3a7f5162cb5
title: submit_work answers "nothing to commit" when `paths` names a directory whose held files it would otherwise carry
ord: 7
tags: ["reflection"]
fields:
  {
    "actual": "`nothing — this session holds nothing the branch does not already carry`, while `git status --porcelain -- packages/performance` listed 36 modified files and `read_changes` on one of them named this very session as the holder. Re-running submit_work with no `paths` at all landed all 36 as commit 442b97ed1f.",
    "command": "submit_work with paths: [\"packages/performance\"], subject: \"Strip prose comments from packages/performance, replaced by its graph zone\" — 36 files under that directory modified and held by this session (1,797 deletions from strip_comments)",
    "expected": "Either the commit of the 36 held paths under that directory, or a refusal saying that `paths` matched none of this session's held paths — anything that distinguishes \"your filter selected nothing\" from \"you hold nothing\""
  }
---
Filed from project `runlith`.

The two answers are indistinguishable at the call site and they mean opposite things. `nothing` is documented as "this session holds nothing the branch does not already carry", so the honest reading of it is that my work was already committed — and that is what I nearly concluded, having just run a strip whose 1,779 dropped lines I had not yet reviewed. What actually happened is that a directory in `paths` selected none of the held entries, which are files.

The cost was one extra verification round: `git log`, `git status` and `read_changes` to establish that the tree really did differ from HEAD and that the change was mine. A session that trusted the first answer would have reported the strip as delivered and moved on, leaving 36 files uncommitted with the task closed against a commit that does not exist.

Either resolution removes the ambiguity: expand a directory in `paths` to the held files beneath it, which is what a caller naming a directory means; or keep the narrow matching and answer a refusal that names the filter, so the caller can tell a bad filter from an empty hold. The second is enough on its own.