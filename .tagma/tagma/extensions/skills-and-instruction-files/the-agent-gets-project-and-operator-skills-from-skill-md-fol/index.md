---
id: 01a14c08-8335-7c28-8f6b-267b0bb6f81f
title: The agent gets project and operator skills from SKILL.md folders and loads the needed one when the task fits
ord: 1
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc0-766c-7277-8b8e-47f50363c0ef
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/capabilities/skills.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/contract/wire/sourceSettings.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/inputs/cache.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/inputs/walk.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/skills/pool.ts
  - kind: file
    ref: packages/agent-sources/src/SkillDirectories.ts
  - kind: file
    ref: packages/agent/src/agent/AgentSkill.ts
---
**Value.** Repeatable know-how — how to review, how to write a report, how to work with an internal service — lies once as a folder with `SKILL.md`, and the agent picks it up only when the task fits, without inflating every start.

**How.** The server walks project skill directories (by default `.agents/skills`, `.claude/skills`, `.codex/skills`) and operator ones (`~/.agents/skills`, `~/.claude/skills`); directories are set by `skills.directories.*`, `skills.project.enabled` and `skills.global.enabled` switch them off entirely. The agent sees the list of skills with descriptions in its instructions and loads the needed one with the `load_skill` tool.

**Behaviour.**
- The skill name is its folder name; `SKILL.md` must carry frontmatter with a `description` and a non-empty body, otherwise the file goes to rejected with a reason instead of vanishing silently.
- On name clashes the later-read directory wins: project overrides personal, an enabled built-in server skill overrides both.
- Loading hands the instructions as the tool result, the system prompt does not change; a skill with a file also hands the absolute path of its folder. Re-loading answers briefly that the skill is already in history.
- Markdown files of the `references/` folder are skill sections: the catalog row lists them as `refs: name (first line of the file)`, `load_skill` with `references` hands the named ones with the body, the agent reads the rest by its folder path.
- Tools a skill brings stay closed until its instructions lie in visible history; compaction that dropped them closes them again.
- When directories are re-read — before every turn, at thread start, or only on request — is decided by `skills.rescan`; a found skill's body is read at load. If the file is deleted after the walk, loading answers with a read error.

**Limits.** Skills go to an agent whose definition grants it the `skills` capability; without it the catalog is empty. Unreadable sources go to rejected with a reason; readable skills from neighbouring sources stay available. Skills are only words: they do not extend the agent's powers.
