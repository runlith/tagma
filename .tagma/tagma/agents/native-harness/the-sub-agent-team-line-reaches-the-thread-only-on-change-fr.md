---
id: 01a15101-ab43-7efc-a255-40e446e7ebcd
title: The sub-agent team line reaches the thread only on change from the last told; with nothing told the baseline is the list from the spawn_agent description
ord: 23
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a150e5-fbff-700e-98b9-7039ac67b9de
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/turns/teamRule.ts
  - kind: file
    ref: apps/tagma/server/src/providers/accounts/connected.ts
---
Before every step the rule compares fingerprints of what the thread allows — a copy of the team from its birth line, otherwise the machine and project `agent.models` and `agent.review` — against the state recorded in the last delivered row. Review counts as off while the resolved team has no reviewer — a count of 0 or no row marked for review. Whether it has one is a fact of the resolved team, so the rule resolves the team again only when the thread's layers or the connected set moved since its last step, and keeps the answer by thread id in between; while on, the review fingerprint includes the list fingerprint: a list edit can mark or unmark a row for review, and then the row repeats the review policy. With no recorded state — a new thread or a post-compaction history — models count as already shown: the `spawn_agent.model` description is assembled from the same list when the run catalog assembles. Review with no record counts as off, so the opening row reaches only a thread that has a reviewer.

The list fingerprint includes the connected-provider-set revision from `ProviderAccounts.connected`: an account connecting or disconnecting mid-run reaches the thread in the same row on the next step. The revision is a hash of the set itself, so after a server restart it repeats until the set changes. The account owner makes it cheap: every credential file lives in one directory and is written by atomic replacement, so any write, including from another process, moves the directory mtime. While it stands, the owner answers the previous set without reading accounts; when it moved, it rereads every provider's accounts and changes the revision only if the set differs (a token refresh does not touch it). A directory changed less than two seconds before its time was read counts as unsettled and is reread on every access: mtime can be coarse, and a second write into the same stamp would otherwise pass unseen. Declaring CLI discovery writes its changed observation into the same account directory, so a local sign-in or sign-out invalidates the connected set without a model-list read starting a CLI. Undeclared CLIs retain addressed selection and bounded list freshness. One owner rereads the set for all threads; a changed connected set reaches working threads at their next step.

The last seen rule is also kept in memory by thread id: with no history record, a change arriving after the first step would have nothing to compare against. After a server restart the new run's description serves as the baseline again.
