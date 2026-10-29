---
id: 01a14bdf-0875-710f-96aa-0c4186e6d82d
title: Refresh rebuilds the thread instructions from the current agent definition
ord: 22
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14bde-4d01-783d-aaa6-fa2527037385",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14bdd-8467-787d-9a76-ee6105c2c634
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/http/instructionRefresh.stest.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/context/actions.ts
  - kind: file
    ref: packages/agent/src/thread/run/assembly/prompt.ts
---
Refresh re-resolves the definition under the thread's stored name with the same resolver as birth, and hands it to the existing composition owner. The new prompt and profile are adopted together on the run's next opening; the running and parked runs keep the adopted composition. A missing or invalid definition refuses without changing the stored one; unchanged capability and tool sets write nothing. A deferred definition is stored in the nullable pending_definition; keep-warm does not consume it. The operation descriptions, agent library, editor, skill, and current graph-record behavior are aligned to this.

Verified: one public HTTP scenario, one stand, and two runs — 21 assertions, 1 pass; it checks updating before the first run, the next composition via read_agent, a tools-only update separately, an allowlist permutation with no write, keeping the adopted profile, keep-warm refusal, and preservation after an invalid and a deleted definition. The existing conformance prompt — 7 passes in memory; SQLite prompt/context — 13 passes, but the file exceeded the integration CPU budget: 8,799 ms against 8,000 ms, further work is [[400ce7e7|lowering the fixture cost]]. The app's bun run typecheck passed with the old CastView.svelte availability warning; server and the agent package have only the operator-named foreign processes.ts:107 error: missing display. Independent [[01a14bee-1dd0-7e4f-a44e-085f555b9750|Sol review]] and [[01a14bee-1dd1-7786-8635-14476d767efb|Wonder review]] read the delivery; confirmed findings fixed. The operator's running server was not restarted, replaced, or stopped; no separate manual check on tagma:try.
