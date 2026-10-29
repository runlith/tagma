---
id: 01a14c08-8336-7b3c-965a-b095d946528f
title: An app gives its tools to every agent of the project, only its own agents, or only its views
ord: 2
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-927fda029bcc
  - kind: relates
    to: 01a14bae-6720-7d62-897a-928acad90fdf
  - kind: relates
    to: 01a14bc0-766c-7277-8b8e-47f50363c0ef
  - kind: relates
    to: 01a14c08-8336-7b3c-965a-b09415a61526
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/capabilities/tagmaApps.ts
  - kind: file
    ref: apps/tagma/server/src/tagma-apps/contract/wire/audience.ts
  - kind: file
    ref: apps/tagma/server/src/tagma-apps/toolPoint.ts
---
**Value.** An app hands its actions to agents — "place a trade", "place a bet" — and decides for each who gets it: every agent of the project, only its own agents, or only its views.

**How.** The manifest's `tools` point names the process tools and each one's audience: `agents`, `own`, `view`. An agent sees the tool as `app__<id>__<tool>`.

**Behaviour.**
- `agents` — lazily to every agent with the `apps` capability in a project where the app is enabled; `own` — only to the app's own agents; `view` — only to the app's views, never to a model.
- A process tool not named in the manifest reaches nobody; one named but not served by the process is a registration refusal with a reason in the app's row.
- A tool without a `readOnlyHint` counts as data-changing and asks the operator in review mode — so an order confirmation comes out with no dedicated mechanism.
- A call arriving during a restart is checked against the manifest of the process that will run it.

**Limits.** In a project where the app is not enabled, all three audiences are empty. App tools do not enter the project's MCP palette and do not collide with an MCP server of the same name.
