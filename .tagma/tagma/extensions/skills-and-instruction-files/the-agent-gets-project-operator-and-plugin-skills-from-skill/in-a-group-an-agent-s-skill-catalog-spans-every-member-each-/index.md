---
id: 01a19935-171f-74b1-a65f-955bd02e8bfc
title: "In a group, an agent's skill catalog spans every member: each member's skills labelled with it, none hiding another's"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a14c08-8335-7c28-8f6b-267cdc8d5770
  - kind: relates
    to: 01a18d86-3376-7adb-aa00-abfaf88b843f
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/inputs/walk.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/inputs/cache.ts
---
## Why

A group is one system kept in several repositories, and an agent homed in any member works across all of them: its start and law already read every member's graph. Its skill catalog does not. `readWorkspaceInputs` walks one project and one root — the operator's global directories plus the project directories of the checkout the thread stands in — and `load_skill` takes no project, so a sibling member's skills are out of reach by any call or `$` reference. A thread in a library cannot load the consumer's release skill while releasing it; a thread in the consumer cannot load the library's test skill while changing the library. Every group user meets this as soon as work crosses a member.

## What stands after

In a project that is a member of a group, the skill catalog of a native thread is the group's:

- **Sources.** Global directories as today; the home member's project directories from the checkout the thread stands in; every other member's project directories from that member's main checkout, in group order — the same copies the group start and law read. Each member's directories come from its own `skills.directories.project`, since they describe its repository's layout; the home's `skills.project.enabled`, `skills.global.enabled`, `skills.own.enabled` and `skills.disabled` decide what the home's agents take. Tagma's own skill for foreign CLIs is recognised in each member's root as in the home's.
- **Labels.** A skill from another member names that member: in the agent's catalog line, in the Skills screen (a group per member after "this project"), in `read_workspace_sources`, `read_agent_skills` and the composer's `$` list. The catalog's header names the group instead of the project.
- **Names.** Within one member the existing precedence holds: later directories win, a project skill overrides a global one, an enabled built-in overrides all, plugin skills yield to them. Between members no skill hides another, because two members' skills of one name are about different code. The home catalog keeps every name it has. Another member's skill keeps its bare name while neither the home catalog (its built-in, plugin, global and project skills) nor another member offers that name; otherwise it takes `<member>-<name>`, the composition plugin skills already use, so both stay loadable and `$`-addressable. A composed name that is itself taken falls under the ordinary precedence and stands on the Skills screen as replaced.
- **Failures.** A member's directories are judged exactly as the home's: a missing directory offers nothing, an unreadable one refuses the catalog with its path (`source-unreadable`), as a member graph that does not open refuses the start.
- **Freshness.** A remembered walk belongs to one member and one checkout; the catalog is composed from the current group membership at each read. Joining or leaving a group, and Re-read on any member's Skills screen, reach every member's next catalog read under every `skills.rescan` policy, with no cross-invalidation between walks. A running thread receives the change as the existing skills world-state update.
- **Unchanged.** A project in no group, and the group's own graph, read exactly as today. Instruction files stay read from the checkout the thread stands in. Plugins stay enabled per project.

## Owners

- `native-harness/inputs` (`walk.ts`, `cache.ts`): splits the walk into a per-member discovery, remembered per member and checkout, and the home's composition over `ProjectGroups.of`, which native-harness already reaches through the projects registry.
- `native-harness/contract`: `SkillInventoryEntry` and its wire schema carry the member a project skill comes from.
- `@runlith/agent` `AgentSkill`: the summary carries an optional place label that `agentSkillLine` renders; the kit learns a label, never projects or groups.
- `native-harness/turns/worldState.ts`: the catalog header.
- App `SkillsSection.svelte`: one group per member.

## Acceptance

- In a group of A and B, a thread homed in A lists B's skills labelled B, loads one with `load_skill`, and its `location` lies in B's main checkout; `$<name>` in A's composer offers and requests it.
- A and B both offering `tests`: A's thread lists `tests` (A's) and `b-tests` (B's), and both load their own bodies. Two non-home members offering one name both take the composed form.
- B leaving the group withdraws B's skills from A's next catalog read under `per-turn`, `manual` and `session-start`; joining adds them the same way.
- Under `manual`, Re-read on B's Skills screen brings a skill added to B into A's next catalog read.
- An unreadable skill directory in B refuses A's catalog naming the path.
- A project in no group answers the same catalog and inventory as before the change.
- The naming is proven through the skill pool's catalog and inventory; the group catalog, a member's Re-read and withdrawal on leaving through `WorkspaceInputs` on a real group and disk.
- Features [[0bb6f81f]], [[dc8d5770]] and [[f88b843f]] are corrected in the same change.

## Not covered

Foreign harnesses (Claude Code, Codex and others) discover skills by their own rules in their own working directory; whether one can be pointed at sibling members' directories was not checked and is not part of this change.
