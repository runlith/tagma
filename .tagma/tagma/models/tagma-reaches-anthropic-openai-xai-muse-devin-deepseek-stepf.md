---
id: 01a14c08-22b6-75de-88f8-5bf8d7d24be1
title: Tagma reaches Anthropic, OpenAI, xAI, Muse, Devin, DeepSeek, StepFun, OpenCode Go, OpenCode, and Cursor out of the box — by subscription, key, or via the vendor CLI
ord: 11
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-92984519ff2b
  - kind: relates
    to: 01a14c08-22b6-75de-88f8-5bfa3af9eb3d
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/adapters.ts
  - kind: file
    ref: apps/tagma/server/src/providers/contract/wire/catalog.ts
  - kind: file
    ref: apps/tagma/server/src/providers/registry.ts
---
**Value.** Large vendors' models work right after installing — by subscription, key, or via the vendor CLI.

**How.** Built-in plugins, one per vendor, compiled into the server and standing on the Plugins screen under Built into Tagma, where only Turn off everywhere acts on them; their models stand in the thread model menu (A1, [[4519ff2b]]), accounts on the Providers screen.

**Behaviour.** Anthropic — API key and Claude Code via CLI ([[6fa09803]]); OpenAI — API key, a ChatGPT subscription via Tagma's own path, and Codex via CLI; xAI, Muse, DeepSeek, StepFun, and OpenCode Go — key; Muse also by a Muse Code subscription, its models in the menu — the ones Muse Code lists plus each one's contributor variant, which Muse Code hides from its list yet runs (measured on 1.4.14): a hosted runner drives the user's signed-in `muse` CLI (`muse serve`) with Tagma's prompt and tools only, in a Muse home that keeps the user's own Muse rules, skills and sessions out; Devin — a Devin CLI thread. Wire providers go over Tagma's own wire path; Cursor is the official SDK local with a loop in a separate hosted runner and Tagma tools. OpenCode is the real V2 engine in a private CLI host with Tagma tools and law: the official CLI ships in the delivery, upstream logins and the conversation are owned by the OpenCode profile. Models, their rungs and switches, badges, and the default model are declared by the adapter, and the window receives them as a live catalog; a built-in adapter loads lazily and on failure does not bring down startup ([[f3189649]]).

**Limits.** Gemini exists only as a CLI thread. The Cursor provider logs in with a user API key, reads available models asynchronously, and keeps the last successful catalog; a live local run of SDK 1.0.40 in this delivery was not checked without a working key. OpenCode uses the official CLI login and the chosen profile's catalog without extracting its credentials; quota is unknown. Its private host and tools are checked by local upstream; the user login and a paid request in this delivery were not checked. Muse Code runs on macOS, Linux and Windows, one Muse account per machine user, measured live on macOS only (the Linux and Windows login is read from the official builds); Muse's compaction keeps its summary inside the session, so the thread shows the boundary without a retelling. Providers of one's own are added by settings ([[eb7e5fc0]]) or a plugin's provider part ([[3af9eb3d]]).
