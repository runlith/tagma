---
id: 01a14c08-22b6-75de-88f8-5bf9eb7e5fc0
title: The operator connects an OpenAI-compatible server — Ollama, LM Studio, vLLM, OpenRouter — from settings, without code
ord: 12
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c08-22b6-75de-88f8-5bf37c1754fb
  - kind: relates
    to: 01a14c08-22b6-75de-88f8-5bfa3af9eb3d
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/providers/instances
  - kind: dir
    ref: packages/adapter-openai-compatible
  - kind: file
    ref: apps/tagma/server/src/providers/adapters/instanceActs.ts
  - kind: file
    ref: apps/tagma/server/src/providers/adapters/instanceRows.ts
---
**Value.** Local and third-party models — Ollama, LM Studio, vLLM, OpenRouter, and any OpenAI-compatible API — stand in the menu beside the rest with no line of code.

**How.** The "OpenAI-compatible providers" section on the Providers screen: name, address, key when needed, and models, with a button to pull the server's model list; the `save_adapter_instance`, `remove_adapter_instance`, `discover_adapter_models` operations; a Tagma agent calls them itself with the `adapters` capability tools, and reads fields and instances with `read_adapter_settings`.

**Behaviour.** Each instance is a separate provider with the id given at creation: renaming does not tear off threads, the default account, or the key. Models need a context window; the output limit derives from the window unless set; picture reading, tool choice modes, reasoning levels, and the request field the level goes to are instance and model marks. The server model list saves nothing: only added models reach the menu. The instance key is its provider's API key; without a key the request is sent without authentication. Saved settings serve from the next run.

**Limits.** An instance without models does not become a provider. Such a provider has no quota or measured cache lifetime.
