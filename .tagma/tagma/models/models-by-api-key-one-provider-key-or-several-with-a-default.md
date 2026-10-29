---
id: 01a14c08-22b6-75de-88f8-5bf37c1754fb
title: "Models by API key: one provider key or several with a default key"
ord: 6
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c08-22b6-75de-88f8-5bf2a65d1a0a
  - kind: relates
    to: 01a14c08-22b6-75de-88f8-5bf419b65523
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/providers/auth/ConsoleKeyGroup.svelte
  - kind: file
    ref: apps/tagma/server/src/providers/credentials/consoleKeyFile.ts
  - kind: file
    ref: apps/tagma/server/src/providers/credentials/consoleKeys.ts
---
**Value.** Models are paid from the developer's account with the vendor, without a subscription.

**How.** The "<provider> API key" section on the Providers screen: paste a key, Replace or Add, Remove, the default-key radio button; the `save_console_key` and `remove_console_key` operations; from the terminal — `tagma auth <provider>`. Anthropic, OpenAI, xAI, DeepSeek, Muse, OpenCode Go, StepFun, and OpenAI-compatible servers work by key.

**Behaviour.** A provider whose key is tied to an identity (Muse, StepFun, OpenAI-compatibles) holds one key, and a new one replaces the previous. At OpenCode Go each key is a separate subscription with its own limits; the rest can also hold several keys and pick a default. The key shows as a short fingerprint, not whole, and the adapter hint says where to get one. Tagma reads the key's quota from the vendor where it gives it, for StepFun only from call answers. Keys lie in the machine file beside the credentials, and the write is verified by rereading and flushing to disk.

**Limits.** Keys are per machine, not per project; the agent neither saves nor reads a key. A rejected key shows as a "Replace key" line.
