---
id: 01a14b6d-b25d-76ba-b814-5e4049b97a6b
title: Agent CLI launched by the operator in the Tagma terminal becomes a project thread
ord: 27
---
An agent CLI the operator launched itself in the Tagma terminal becomes a thread of the project whose directory it counts as working: it is visible in the list and works with Tagma's law and tools like one launched from a thread.

**How.** The CLI's hook calls `adopt_harness_session` with the process ancestors it read. The server proves this is its own operator pty terminal (not one launched for another thread) and that the CLI stands under it, and answers with the thread and grant the CLI then carries.

**Limits and refusals.** A shell unknown to the server — `shell-unknown`; the CLI not under that shell — `not-under-shell`; a CLI without Tagma hooks — `harness-unhooked`; unproven shell assignment — `job-unproven`. A session that could not be proven ends without stopping the CLI and returns to the same thread as a regular hook.

Code: apps/tagma/server/src/external-harnesses/adoption/adopt.ts#makeAdoption, apps/tagma/server/src/external-harnesses/adoption/shellJob.ts, apps/tagma/server/src/external-harnesses/contract/wire/hooks.ts
