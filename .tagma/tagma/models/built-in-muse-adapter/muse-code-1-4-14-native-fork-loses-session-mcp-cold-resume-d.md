---
id: 01a19a1a-08f1-7902-bc38-8e50094811e1
title: Muse Code 1.4.14 native fork loses session MCP; cold resume does not prove request identity
ord: 4
tags: ["research"]
fields:
  {
    "source": {
      "name": "Muse Code MSP native session fork",
      "ref": "Muse Code 1.4.14-R7309.1, @muse-code/sdk 1.4.10; isolated echo-provider probe 2026-11-02"
    }
  }
edges:
  - kind: relates
    to: 01a19543-e28b-72c2-95c9-7181e698aca6
---
Read and measured on 2026-11-02: Muse Code `1.4.14-R7309.1` through the pinned `@muse-code/sdk` 1.4.10. The probe launched the installed binary directly with `--provider echo`, an empty isolated HOME/XDG tree and one loopback MCP server; it read no account, contacted no vendor model and incurred no model spend. Its script is `/Users/teunlao/.tagma-dev/scratch/01a19a02-5841-751e-a925-736b526fcb2e/muse-fork.mjs`. Temporary vendor records are under `/private/var/folders/87/cmcr9wbs5yqcbthnzgqp7lh80000gn/T/muse-fork-offline-aVliY6/data/muse/sessions/2026/11/02/`.

Source session `01a19a0f-339d-7532-986f-a15a5332aad3` completed an echo turn with the whitelisted `mcp__probe__*` catalog. `session/fork` through that completed turn returned `00000000-0000-7156-9e42-416b6bffaa91`. Its next turn failed before a provider completion: `configError`, `invalid run configuration: unknown tool mcp__probe__*`. The fork therefore did not retain the source's session MCP configuration.

After the host closed, a fresh host resumed both ids with the original MCP configuration. Both resumed turns completed. The earlier 1.4.10 observation of a fork refusing cold resume with `missing field recorded_at` did not reproduce here; native fork's MCP loss did. This does not establish that a fork immediately closed before any turn is byte-identical after resume.

The fork's durable `model_input_trace_recorded` event labels inherited lanes as `external_history`, while `provider_request_options_configured` lists `meta.session_id` and reports `prompt_cache_key_source: unavailable` on the echo provider. No real Meta request, reasoning replay, serialized model request equality or cache read was observed. A native fork followed by cold resume is therefore not evidence of the byte-identity contract; Tagma retains journal rebuilding for Muse forks, with its known loss of vendor-private history and reasoning.
