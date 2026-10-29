---
id: 01a126ba-9e4f-74d9-b75f-49a423f76dde
title: Scheduled subagent archiving that itself skips threads where the operator worked
ord: 4
tags: ["idea"]
fields:
  {
    "status": "open"
  }
---
Motivation: today subagent threads archive almost only on the operator's word. Spent subagents pile up and clutter the list.

Idea:
- **More frequent, scheduled archiving.** The lead agent archives its subagents itself, and archiving runs on schedule. Garbage does not pile up.
- **An operator-participation mark.** The agent sees whether the operator interacted with the thread: wrote into it, clarified or asked something — i.e. itself ran work in that thread. This is a thread mark, readable in `list_agents` and thread reads.
- **Archiving skips threads with operator participation.** The agent itself sees "I won't touch this one, it may hold something important", and scheduled archiving walks around such a thread. There is no ban in this: on the operator's direct word such a thread archives like any other.

To decide:
- What counts as operator participation: only its messages in the thread, or other acts too (answering a question, Stop, edits, views).
- Who runs scheduled archiving and when: project schedule, the parent task's end, or thread idle past a threshold.
- How to combine this with the current law "one's own one-shot child archives; a child the operator asked for or that did real work stays".
