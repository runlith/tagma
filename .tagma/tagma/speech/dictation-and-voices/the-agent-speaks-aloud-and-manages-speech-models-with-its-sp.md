---
id: 01a14c08-619e-7ae1-af8b-16d5ed8a107b
title: The agent speaks aloud and manages speech models with its speech tools
ord: 10
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c08-619e-7ae1-af8b-16c8362f480f
sources:
  - kind: file
    ref: apps/tagma/server/src/speech/contract/wire/capability.ts
  - kind: file
    ref: apps/tagma/server/src/speech/operations.ts
---
**Value.** The agent speaks aloud and keeps the speech models it needs on its own.

**How.** Speech tools come to the agent whose definition carries the `speech` capability; of the built-ins it is the Tagma agent. These are the `speak_text`, `stop_speaking`, `speech_status`, `install_speech_model` and `remove_speech_model` operations, and any operation another module offers on the same capability.

**Behaviour.**
- Speaking aloud asks the operator in review mode.

**Limits.** Recording-free recognition is the operator's only; the agent has no tool for it. The agent hears no sound, only text. Voice is only on the server machine.
