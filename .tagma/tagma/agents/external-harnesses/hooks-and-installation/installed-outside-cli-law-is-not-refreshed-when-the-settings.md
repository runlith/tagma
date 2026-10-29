---
id: 01a14617-3974-76a7-9555-cf6fa8ad0545
title: Installed outside-CLI law is not refreshed when the settings it reads change
ord: 9
tags: ["task"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/installs/upgrade.ts
---
The law installed for outside CLIs is not refreshed when the settings it was built from change. The law for Claude Code and Codex in the public project lives in the installed `AGENTS.md` / `CLAUDE.md` (`external-harnesses/installs/skillInstall.ts` `installInto`). It is assembled from doctrine with the `agent.checkout`, `writing.comments`, and `agent.autoCommit` of the moment the install or upgrade ran (`installs/upgrade.ts` `refreshInstallations`: `tagma setup` and assembly). Writing a setting does not rewrite it (`graph/vocabulary/settingsReaction.ts`), so an outside CLI works from the old value while native agents, preview, and `read_law` follow the current one.

To do: a write of any of these project settings rewrites the installed law of that project (its checkouts), or an outside session receives the acting law at start with an explicit replacement of the installed one.

Done when: after `write_setting agent.autoCommit` a new outside session in this project sees the Commits section of the new mode; a test on this contract.
