---
id: 01a14c14-a11c-7ce8-9d84-63363d3e5239
title: "An ordinary git commit in a project checkout is also judged by the law: an agent can't smuggle a violation through, the operator only explicitly"
ord: 3
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-6337de2c63cd
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/cli/check.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/commits/hooks.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/commits/queue.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/contract/wire/gateHook.ts
---
**Value.** The law holds the branch even when commits bypass Tagma — by hand in the terminal, from an IDE, or by a foreign CLI: an agent doesn't bypass the gate, and the operator, letting a violation through, leaves a trace.

**How.** The commit gate — the `pre-commit`, `pre-merge-commit`, `prepare-commit-msg`, `post-commit`, and `post-merge` hooks Tagma installs in every registered checkout; they call `tagma check --gate` (the `gate_commit` operation) and `tagma check --landed` (the `record_commit` operation).

**Behaviour.**
- The operator's commit is judged by the same court as a landing and refused on a new gated-rule violation; an explicit environment variable lets it through, and every let-through violation is recorded as an escape behind the operator.
- An agent's commit, running with a thread's authority, refuses a real gated crossing. An inspection that cannot judge passes the commit as unjudged with its failure, recorded in the rule's graph history; an unanswered server still refuses the agent's commit.
- A refusal that stopped an agent's or the operator's commit is recorded like a landing refusal and visible on the rule page under "Commits blocked" as `git commit` — with the agent or operator, branch, and commit it was judged against; a commit the operator explicitly let through isn't recorded as a refusal. A manual `tagma check` writes nothing.
- If Tagma isn't where the hook points, the operator's commit passes with a warning, and the agent's commit is refused.
- After the commit, the server queues it, judges it against the parents, and records the missed as the committer's escapes; rules triggered after `submit_work` run over it.
- The repository's previous hooks (husky and others) join the chain and run first under their own name.
- The gate is installed at registration, at checkout publication, and at every server start.

**Limits.** A hook overwritten by a hooks manager mid-session returns only at the next installation ([[b07cc691]]). A terminal `git merge` auto-merge is judged against the first parent: the second isn't recorded yet. A hooks directory outside the repository or a tracked hook isn't touched by the gate. If one rule's inspection over a queued commit failed to run, the other rules' escapes are still recorded behind the committer, and this rule's violation is found by the next remeasure — already without a holder.
