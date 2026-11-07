---
id: 01a14c08-22b6-75de-88f8-5bfc99c7336a
title: An author writes their own model or speech provider as a plugin's provider part and checks it with conformance tests before installing
ord: 15
tags: ["feature"]
fields:
  {
    "state": "partial"
  }
sources:
  - kind: dir
    ref: packages/tagma
---
**Value.** A provider Tagma does not know can be added by anyone without touching the core, and checked before installing that Tagma will accept it.

**How.** A plugin's providers module, `defineProviders({models, speech})` from `@runlith/tagma/plugin`, with `defineAdapter` from `/adapter/provider` and `defineSpeech` from `/adapter/speech`; `tagma-plugin build`, which bundles it into `dist/providers.js` and describes what it brings in `tagma-plugin.json`; `runConformance` from `@runlith/tagma/testing`, which runs the built folder with no Tagma; the plugin template, the only one.

**Behaviour.** The contract is one for built-ins and plugins: every built-in adapter is written on it. A model provider is declared as a wire — the call goes by Tagma's native agent over HTTP: models, request profile, login, quota — or as a harness — the call goes by the vendor's CLI: models, CLI login, account environment. A harness may also declare terminal or ACP transports, its hook codec and its metadata reader, so a plugin can supply a CLI thread. It may declare login paths, borrowing another provider's accounts, the section login mode, and a settings schema with instances; the part brings no interface, the screen is drawn by Tagma. A speech provider declares its models and capabilities as data and speaks through the speech kit's duplex runner. Conformance takes the declaration apart by the registry's own check, runs a login, a model call and a failure against a stub and requires `LLMError` errors; a speech provider passes the speech catalog's rules and one recognition or synthesis against a stub.

**Limits.** The package is marked `private` and is not published to npm, so an author outside the monorepo will not receive it; publication is promised by spec [[52b10a62]] to the first external author.
