---
id: 01a0d095-1636-7746-88b6-3c160d22c6ca
title: "Why page figures are derived per reader: unbounded and borrowed page sizes measured on 2026-09-22"
ord: 2
---
**A borrowed page size.** On 2026-09-22 `search_blocks` answered a fixed page of 40. Its written derivation was the command palette's list height at a 1440 px window, so an agent had inherited a figure calibrated for someone who scrolls, with no way to change it.

**Unbounded reads.** `ready_tasks`, `read_reflections`, `read_proposals` and `query_blocks` answered unbounded lists. An unbounded aggregate walk over 2,699 threads killed the server process twice in one afternoon.

**Why the default sits where a read ends.** A second page costs a model step billed at hundreds of thousands of input tokens, while the rows that would have ended the read cost a few thousand.