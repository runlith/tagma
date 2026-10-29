---
id: 01a14c08-8336-7b3c-965a-b08cea36cd32
title: "The server brings the agent its own skills: pages, motion, product showcase in screenshots, project rules, agent definitions and apps"
ord: 3
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-928acad90fdf
  - kind: relates
    to: 01a14c08-8335-7c28-8f6b-267b0bb6f81f
sources:
  - kind: dir
    ref: apps/tagma/server/src/native-harness/skills/apps
  - kind: dir
    ref: apps/tagma/server/src/native-harness/skills/rules
  - kind: file
    ref: apps/tagma/server/src/native-harness/skills/agentDefinitions.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/skills/artifacts.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/skills/motion.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/skills/pool.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/skills/showcase.ts
---
**Value.** A Tagma agent in any project, even one with no skills of its own, can do what the product counts as its craft: make a page, make motion, show the product working in screenshots, keep project rules — from writing a norm to checks, debt and commit formatting — describe a new agent, build an app.

**How.** Six skills are built into the server and stand in the catalog next to ones found in directories: `artifacts` (page design and the publish tool), `showcase` (isolated product run, frame capture, a page with captions and defects), `motion` (motion — code-driven animation under the timeline contract, user assets, frame checks before delivery) and `agent-definitions` (agent file format) — as server code; `rules` (rule, check from it, `enforce_rule`, debt and escapes, own inspections and linters, format commands with a baseline commit, the Rules screen) and `apps` (manifest and points, process and its callers, view bridge, Tagma operations from the process, threads, agents, secrets, schedules and app notifications, debugging; references — one minimal app and speech in a view) — as `SKILL.md` folders with `references/` in `native-harness/skills/`. A release copies such folders into `skills/` of the installation, and `load_skill` answers the installation's `location`. Any Tagma agent gets the skills, including the harness over MCP.

**Behaviour.**
- An enabled built-in skill occupies its name: a same-named skill from directories stands in the list as disabled. A built-in disabled in `skills.disabled` does not occupy the name: a project or user skill with the same name takes its place, and the list marks the built-in as replaced.
- A disabled `artifacts` changes `showcase` and `motion`: the page is not published but written as a file into scratch, and the agent names its path. `motion` carries no tools of its own: publishing comes from `artifacts`, frames from the `read_artifact_frames` operation under the `artifacts` capability.
- `rules` is kept current by the [[de8d5a75|rule on changing the rules mechanism]], `apps` by the [[7cb3c1cf|rule on changing the app mechanism]].

**Limits.** The Skills screen shows a built-in skill as "Always", "Off" or "Replaced" with no toggle: only the `skills.disabled` setting can disable it (see [[dc8d5770]]).
