---
id: 01a14bae-6720-7d62-897a-9286739b512c
title: "Operator sees the agent team in the app: the tree in the thread list, working children in the \"This thread\" button, and counters of what awaits the operator"
ord: 6
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: supersedes
    to: 01a14b6d-b220-73bf-9f19-a76f58042986
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/Life.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/Row.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/TeamMember.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/ThisThread.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/shared/ui/AgentCounts.svelte
  - kind: file
    ref: packages/agent/src/collaboration/CollaborationTools.ts
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/threads/team.ts
    symbol: crewOf
---
**Value.** The operator sees what each agent of the team does and who waits for the operator, without opening threads one by one.

**How.** The tree in the thread list, counters at the branch button, the "This thread" button in the thread header with a tile of working children, launch and send cards in the parent's feed.

**Behaviour.** Children stand under the parent; a collapsed tree counts the team's agents by state — asking, failed, working — as a state tile with a number, askers first; finished ones are not counted. A collapsed thread folder and the worktree button carry the same record. A row distinguishes working, stuck (no movement past its transport's threshold), waiting for the operator, failed, cut short, finished, and stopped. A child from another project stands under its parent with a project mark. From the row, the operator can answer, continue, stop, or compact. While a direct child's run goes, the "This thread" button shows their count next to a breathing tile, and its menu shows an Agents working section: their rows by launch time, with a state tile, name, and time. A row is a link to the thread: a click opens the child beside, ⌘-click — in place of the main one, right-click — the link menu. When the team also has non-working agents, the last row — "Show all N agents" — opens the whole subtree in the thread list. When no child works, there is no section: finished ones are shown by the tree in the thread list, and an "All N" row without the word "agents" and with no working agents beside it was unclear about what it counted.

**Limits.** The Attention list, the "seen" mark, and notifications are the conversation-and-attention area (A2). What a child does right now is shown by its row in the thread list, not the menu.
