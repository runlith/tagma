---
id: 01a14c08-1c3f-7bde-a2e3-047574109856
title: A thread on a Claude or ChatGPT subscription searches and reads the web with the provider's own tools; the agent.web setting returns Tagma tools
ord: 3
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/capabilities/web.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/tools/vendorWeb.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/turns/runWebs.ts
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/settings.ts
    symbol: agentWeb
---
**Value.** A thread on a Claude or ChatGPT subscription searches and reads the web like the provider's own client — with its search and on its quota.

**How.** The `agent.web` setting (`vendor` by default, or `tagma`, per user and per project).

**Behaviour.**
- With `vendor`, the provider's tools take the place of `websearch` and `webfetch` under the same names in the journal, feed, and approvals; a tool the provider did not declare leaves the catalog. Claude declares both, OpenAI declares only search (its `web.run` opens pages itself).
- The source is decided when the run opens and again on a step with a different model; a setting change takes effect from the next run.
- A provider-web failure is a call refusal, with no fallback to Tagma tools.
- A hosted Claude Code flow gets provider web when its profile declares it and the agent holds the `web` capability.

**Limits.** Provider web exists only for models whose web shape is recorded in the provider client's generated fingerprint. A model without its own web, and terminal Claude Code, always use what they have.
