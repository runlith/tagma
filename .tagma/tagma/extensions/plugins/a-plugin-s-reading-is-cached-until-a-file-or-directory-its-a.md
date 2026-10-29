---
id: 01a18925-fae6-7bb4-9839-a12394acee94
title: A plugin's reading is cached until a file or directory its adapter read changes, and bound to a project on every use
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/plugins/shelf.ts
---
Its components are read on every agent step and every tool call (hooks), so reading the directory each time would walk it per call. While an adapter reads a package, every path it stats, lists or reads through the shared reading helpers is recorded (`PluginReads`), absent ones included; the cache keeps that set with a stamp of their modification times, and a use re-reads the package only when the stamp moved. So an edited agent file, a manifest-named hooks or MCP file, or a newly added `hooks/hooks.json` in a folder installed in place is read again on the next use, and the core names no format's files. A reading that fails is not cached. The price is one stat per recorded path per use; command bodies, agent prompts and skill bodies are read from their files when used. Binding — the place with the project root, option values and secret values — is redone per use; `PluginLoaded.revision` hashes the stamp and the place, so a consumer that caches its own derivation keys on it.