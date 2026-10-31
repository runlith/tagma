---
id: 01a14c14-6895-75c6-80f2-47b7039c7507
title: A lost answer to a start or stop is read back by operation key instead of repeating the act
ord: 10
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47b8441e23be
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47bda6e02fd0
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/contract/wire/requestKeys.ts
  - kind: file
    ref: apps/tagma/server/src/executions/store/requestKeys.ts
---
**Value.** A dropped connection in the middle of starting a terminal, a command, or a stop causes neither a second process nor a false "nothing happened".

**How.** The agent names its `operationId` before the call and reads the outcome with `read_terminal_operation`; `bash` names the key if its start outcome is unknown; the window itself reads the outcome of its own stops and Take over.

**Behaviour.** The same key answers with the same act and never starts a second one. Reading the outcome distinguishes a pending, accepted, decided, undetermined, and expired act; "unknown" means only proven absence or a key the storage already forgot. Unavailable storage or host is a read failure, not proof that the act is missing. A stop result received from the host is kept together with the decided key: its author reads the same receipt with confirmed endings, surviving and unmeasured resources, without asking the host again. A live stop dispatch keeps ownership from registration through settlement; interruption leaves an uncertain key for readback. For an execution-specific stop whose dispatch owner is gone, an unanswered lookup triggers explicit conditional prevention under that same key. Only the host's durable prevention proof settles it without a receipt: a delayed original stop can no longer be admitted. An uncertain answer, an unavailable host, or a host without that prevention capability proves no absence.

**Limits.** A key lives a limited time, after which the same name starts a new act. Signals and key reads hold nothing. `read_terminal_operation` is a tool of the terminals capability, and the `bash` answers and the `stop_command` description point an agent with only shell to it.
