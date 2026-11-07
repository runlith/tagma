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
  - kind: file
    ref: apps/tagma/server/src/composition/speechSources.ts
---
The console-keys door, the default account and the key snapshot accept providers outside the model catalog. Composition gives their ids through the `KeyedProviders` port, read on every use from the judged catalog of the speech parts standing now: speech providers with a required credential, a plugin's included, so a provider the catalog refuses never reaches key or account reads. The model catalog does not know them, and the model quota and account lists do not show them: their keys are read by `list_console_keys`, so the window enumerates speech providers without knowing their names. Removing the default key passes default to the single remaining key, and with several or none removes it: a default onto a deleted key would sign what no longer exists. Key choice stays: the explicit account first, then the default account, then the single key. Subscription providers are OAuth, and all the rest store a console key. Account reads and the snapshot rely on this distinction.

One id means one key. A model provider and a speech provider share an id, and so its key, only inside one plugin, as OpenAI's do; a speech provider whose id another plugin serves as a model provider is refused, whatever the install order, with the holder named on its card. A ChatGPT/Codex OAuth account has nothing to do with speech.

The `speech` module fills the `SpeechCredentials` port. It reads the default account with `DefaultAccounts.heldAccount`, which does not admit the provider against today's console list: speech asks only for a provider a set it holds contains, so a recognition started before its plugin was turned off or removed keeps signing with the saved key, while new work cannot choose that provider at all. "No key" (`no-key`) and "several keys, no default set" (`ambiguous-key`) are different refusals, each with its own `unblock`. Both are non-retryable, so a lane with nothing to sign with ends at once instead of waiting for reconnect attempts.
