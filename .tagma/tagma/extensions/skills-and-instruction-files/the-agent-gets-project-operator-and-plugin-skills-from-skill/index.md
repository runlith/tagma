---
id: 01a14c08-8335-7c28-8f6b-267b0bb6f81f
title: The agent gets project, operator and plugin skills from SKILL.md folders and loads the needed one when the task fits
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
    ref: apps/tagma/server/src/native-harness/inputs/plugins.ts
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

**How.** The server walks project skill directories (by default `.agents/skills`, `.claude/skills`, `.codex/skills`) and operator ones (`~/.agents/skills`, `~/.claude/skills`); directories are set by `skills.directories.*`, `skills.project.enabled` and `skills.global.enabled` switch them off entirely. A plugin enabled in the project adds its skills and its commands under `<plugin>-<name>` in the `plugin` scope; the skills screen names the plugin of each. The agent sees the list of skills with descriptions in its instructions and loads the needed one with the `load_skill` tool.

**Behaviour.**
- The skill name is its folder name, except a plugin skill, which is offered under the name its plugin composed; `SKILL.md` must carry frontmatter with a `description` and a non-empty body, otherwise the file goes to rejected with a reason instead of vanishing silently.
- On name clashes the later-read directory wins: plugin skills are read first, personal overrides plugin, project overrides personal, an enabled built-in server skill overrides all. A replaced plugin skill stays on the skills screen as replaced, naming the scope that stands in its place, so a clash is never silent.
- In a group, a member's thread also gets every other member's project skills, read from that member's main checkout by its own `skills.directories.project` and labelled with the member in the catalog line. A member's skill keeps its name unless this catalog — built-in, plugin, personal or project — or another member offers it; then it is offered as `<member>-<name>`, so no member's skill hides another's. A composed name already taken stands on the skills screen as replaced. Joining or leaving the group, and Re-read on any member, reach the next catalog read under every `skills.rescan`. An unreadable skill directory of a member refuses the catalog as the project's own does.
- A plugin command is a skill whose instructions are the command's text; `$ARGUMENTS` in it becomes the words of the reader message that requested it with `$<name>`, without the reference itself. A new request with other words loads it again.
- A plugin skill's body reaches the agent with its format's variables expanded (Claude Code `${CLAUDE_PLUGIN_ROOT}` and the like). Its `SKILL.md` and `references/` files must resolve inside the plugin's folder: a skill whose file, symlinks followed, lands outside goes to rejected, and a file swapped for such a link later fails to load.
- `skills.disabled` switches a plugin skill or command off by name, like any other. Disabling the plugin in the project withdraws all of them at the next catalog read, whatever `skills.rescan` says.
- Loading hands the instructions as the tool result, the system prompt does not change; a skill with a file also hands the absolute path of its folder. Re-loading answers briefly that the skill is already in history.
- Markdown files of the `references/` folder are skill sections: the catalog row lists them as `refs: name (first line of the file)`, `load_skill` with `references` reads the named files alongside the current body, including sections added after discovery; the catalog itself still follows the rescan policy. The agent reads other sections by the folder path.
- Tools a skill brings stay closed until its instructions lie in visible history; compaction that dropped them closes them again.
- When directories are re-read — before every turn, at thread start, or only on request — is decided by `skills.rescan`; a found skill's body is read at load. If the file is deleted after the walk, loading answers with a read error.

**Limits.** Skills go to an agent whose definition grants it the `skills` capability; without it the catalog is empty. Unreadable sources go to rejected with a reason; readable skills from neighbouring sources stay available. Skills are only words: they do not extend the agent's powers.
