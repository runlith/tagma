---
id: 01a14c08-22b6-75de-88f8-5bf419b65523
title: Speech provider keys are entered and kept on the Providers screen beside model keys
ord: 7
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/providers/auth/SpeechKeyGroup.svelte
  - kind: file
    ref: apps/tagma/server/src/providers/contract/service/credentials.ts
---
**Value.** A speech vendor's key for dictation and calls is entered where model keys are, and kept the same way.

**How.** Speech provider sections at the bottom of the Providers screen; the `list_console_keys`, `save_console_key`, `remove_console_key` operations.

**Behaviour.** Tagma learns which speech providers to show from the speech module, without knowing their names. One id is one key: speech OpenAI takes the OpenAI model provider's key, so that key is entered once in its API-key section. Several keys of one provider — with a default; deleting the default key passes the default to the only remaining key, otherwise clears it. If there are no keys or several without a default, speech refuses at once, without reconnect attempts.

**Limits.** Speech keys have no quota. What the key does in recognition and synthesis is the speech area (A8).
