---
id: 01a113e2-1923-79b6-8146-40f943655a6c
title: Marking agent participation in a commit (Co-Authored-By) — only by the project owner's choice
ord: 2
tags: ["idea"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/landing/land/publish.ts
---
Claude Code appends `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` to every one of its commits (a system reminder in the Claude Code 2.1.292 capture). This is a GitHub convention: it shows a second author on the commit. The user never chose that line personally, and it advertises the vendor.

How the idea differs for Tagma:
- **Off by default.** Only the project owner enables it; Tagma appends nothing on its own. For runlith this is currently forbidden (`AGENTS.md`: "NEVER include … `Co-Authored-By`").
- **Not vendor advertising but fact.** The line names who actually wrote: the model and session from the change record, which knows whose lines the commit carries. No line when the commit holds only human work, e.g. an operator commit from the panel with no agent lines.
- **The team sets the format.** Possibly a template: name, email (each team its own — `noreply`, a bot account, a team address), a set of trailers (`Co-Authored-By`, `Assisted-by`, a task or thread link).
- **The same for every commit path.** Placed in the shared publish path (`makeCommit`), so it covers `submit_work`, `commit_checkout`, merge and pull.

Why it may be needed: some teams and open-source projects must mark AI participation in code. On GitHub such a mark is visible without Tagma.

To decide before accepting: where the choice lives — a project setting, `tagma.jsonc`, Tagma's local project memory, or elsewhere, undecided; what to write when a commit carries several models' lines; what to do with the `commit-msg` hook that checks the message format.
