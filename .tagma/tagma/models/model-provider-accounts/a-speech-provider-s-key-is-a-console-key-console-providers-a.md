---
id: 01a10733-4754-7c8f-b0c6-e6ed1d071781
title: "A speech provider's key is a console key: console providers are model api-key providers plus speech provider ids that composition hands to the KeyedProviders port"
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/providers/contract/wire/catalog.ts
  - kind: file
    ref: apps/tagma/server/src/speech/credentials.ts
---
The console-keys door, the default account and the key snapshot accept providers outside the model catalog. Composition gives their ids through the `KeyedProviders` port: speech providers with a required credential. The model catalog does not know them, and the model quota and account lists do not show them: their keys are read by `list_console_keys`, so the window enumerates speech providers without knowing their names. Removing the default key passes default to the single remaining key, and with several or none removes it: a default onto a deleted key would sign what no longer exists. Key choice stays: the explicit account first, then the default account, then the single key. Subscription providers are OAuth, and all the rest store a console key. Account reads and the snapshot rely on this distinction.

One id means one key. The speech `openai` deliberately shares the key with the model's api-key provider of the same id once it appears. A ChatGPT/Codex OAuth account has nothing to do with speech.

The `speech` module fills the `SpeechCredentials` port. "No key" (`no-key`) and "several keys, no default set" (`ambiguous-key`) are different refusals, each with its own `unblock`. Both are non-retryable, so a lane with nothing to sign with ends at once instead of waiting for reconnect attempts.
