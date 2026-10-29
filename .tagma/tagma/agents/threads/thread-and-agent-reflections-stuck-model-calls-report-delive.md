---
id: 01a13f63-559c-7cb3-89b6-c4497c5a08d3
title: "Thread and agent reflections: stuck model calls, report delivery, load_skill"
ord: 52
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f64-c077-73c7-96db-36b53fc38067",
    "status": "done"
  }
---
Fix the reflections' outright defects at the root:
- [[e9f93dfe]]: runs hung on a model call for 26–40 minutes; the sub-record has a stall window, but these calls ran without one.
- [[2cabd9db]]: a child's final answer closes a task queued for it and not yet opened.
- [[d0504a54]]: continue_agent on a child just woken by a message answers with a storage failure instead of a "running" refusal.
- [[3bc177d6]] and [[ac2fd629]]: a reviewer on muse cannot send a final answer via send_message.
- [[3db73bca]]: tool_search marks read_zone as direct, but the reviewer receives no callable tool.
- [[021983df]]: load_skill treats a changed skill as loaded and does not serve the new revision.
- [[44ac6d04]]: read_thread select entries fails wholesale when the thread has no rollout file.
- [[99257789]]: read_thread_record does not open an oversized toolOutput even in a separate call.
- [[00ccad69]]: a typed ACP-session launch refusal (unknown-account) spins every 15 s as uncertain, the run hangs in Working.

Outcome:
- d0504a54 fixed in d308ff9000: opening a run after redeclare compared facts against the original list and spun until the deadline.
- 44ac6d04 fixed in 9207181cdf: query and expand held the thread lease only on empty work, and offload compacted the rollout under the read. No deterministic race test.
- e9f93dfe and 7b3ada53 already fixed in 02ece96baa and ac47d94ddb: the grep tool hung, not the model call.
- 00ccad69 already fixed in 789a72240b.
- 2cabd9db does not reproduce: a queued task opened run 01a1320c 0.3 s after the previous end.
- 3bc177d6 fixed in 6e993e309d: `to` on send_message, send_task and interrupt_agent is always a list; the "string or list" union the model passed as a string with JSON inside.
- ac2fd629 and 3db73bca do not reproduce: the captured request to muse on that very call carried 34 tools, send_message and read_zone among them; the same model in another thread calls both.
- 021983df and c93da993 fixed in 2442b27b7b and 68f037b025: the skill body is read from disk asynchronously on every load, and an unreadable skill counts as unloaded.
- 99257789 fixed in 2d324f1ce5 and f3040763c2: read_thread_record with `outputFrom` reads tool output page by page in bytes, held output — by bounded reads of its file.

First check each against the current code for reproduction. An item whose fix needs a product decision is not done but named in the report. Proof — a contract test where one exists, and a landed commit; fixed reflections are answered via answer_reflection.
