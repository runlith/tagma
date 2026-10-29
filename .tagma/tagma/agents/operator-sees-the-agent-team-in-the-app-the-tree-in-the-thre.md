---
id: 01a14b6d-b220-73bf-9f19-a76f58042986
title: "Operator sees the agent team in the app: the tree in the thread list, the Team button in the thread, and counters of what waits for them"
ord: 17
---
The operator sees what each agent of its team does and who waits for the operator, without opening threads one by one.

**In the thread list.** Children stand under the parent as a birth tree; a collapsed tree shows the team counters — how many work, ask, fell. Row state: working, stuck (no movement past its transport's threshold), waiting for you, fallen, cut, finished — unread, finished, stopped by you, idling. A child born in another project stands under its parent with a project mark, while its feed, answer, stop, and other acts are addressed to its home's project. Above the list — "working / waiting for answer / unseen" counters jumping to the first. Peek and the row menu answer, continue, stop, compact.

**In the thread.** The Team button in the header: the child count and how many work; a popover over Working / Waiting / Failed / Done groups, each with its own team and questions under it; up to three active children stand as chips, a click opens the child beside. In the parent feed a `spawn_agent` card opens the child's thread and names type, model, rung, and the downgraded; send cards name recipients and delivery.

**Via operation.** `read_attention` — the operator's threads in all projects that need a human: an open question, a fallen or cut and unseen run (a child too), a finished and unseen root (a child's end reaches the parent as a report); archived ones are not in. `mark_thread_seen` drops the mark.

**Links.** Reading agent state via operations; operator notifications (Attention and push) — a separate module.

Code: apps/tagma/app/src/lib/features/threads/TeamButton.svelte, apps/tagma/app/src/lib/features/threads/team.ts#teamChips, apps/tagma/app/src/lib/features/threads/TeamCounts.svelte, apps/tagma/app/src/lib/features/threads/Life.svelte, apps/tagma/app/src/lib/features/threads/tree.ts#attentionOf, apps/tagma/app/src/lib/features/threads/Row.svelte, apps/tagma/server/src/threads/contract/wire/operations/attention.ts, packages/agent/src/collaboration/CollaborationTools.ts
