---
id: 01a14648-9188-7287-90ac-01a4eed81d54
title: The description setting changes the bash declaration when the run opens
ord: 14
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a14644-63f0-7577-95c9-9e2841d7e50f
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/contract/wire/settings.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/turns/commandDescriptions.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/turns/context.ts
  - kind: file
    ref: packages/agent-tools/src/bash/tool.ts
---
agent.commandDescription sets a requirement on the model, not an execution condition: a missing description must not cost a refusal and a repeated step. The tool separates the model declaration (inputSchema) from call acceptance (parameters); the bash owner prints the short header. The choice is held by runId until the run is computed, including parking on a question and resuming after the answer: rerunning the loop does not open a new run. This keeps schemas in the warm prompt cache when the setting changes.
