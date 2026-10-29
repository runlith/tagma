---
id: 01a12699-1673-714b-a6a5-79f07d9d39c0
title: "Retention for history tables outside the thread journal: what stays history and who declares the term"
ord: 1
tags: ["idea"]
fields:
  {
    "status": "closed"
  }
---
Several machine-database tables grow with use and have no retention: `command` (315k rows), `terminal` (343k), `thread_run_transition` (810k), `root_use` and `root_use_hold` (about 660k each), `target_snapshot`, `thread_inbox`, `thread_run`, `thread_message`, and in graph mirrors `event`. The counts are one measurement on one machine; no code paths deleting rows from these tables were found. `terminal_request_key` has a retention.

Under [[9631d38c]] these are history tables, and migrations do not touch them. Without a retention, the declared heavy update over them grows more expensive over time, and the database grows without bound.

What must be decided before this becomes a spec:

- **What of this is history a person reads** (thread commands and terminals, run transitions) and what is accounting needed only while the work runs (`root_use`, holds, target snapshots).
- **Whether history leaves with the thread** — into its rollout on eviction — or lives by a calendar term.
- **Who declares the term:** the table owner in the manifest, next to its class, or a setting.

The measurement from [[c3af42eb]] — the database broken down by table on a copy — will show which of these tables matter at all.
