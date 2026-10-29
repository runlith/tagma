---
id: 01a18925-fae6-7bb4-9839-a12394acee94
title: A plugin's reading is cached by the modification times of its manifest and component locations, and bound to a project on every use
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/plugins/shelf.ts
---
Its components are read on every agent step and every tool call (hooks), so reading the directory each time would walk it per call. The cache key is the root and a stamp of the modification times of the root, both manifests, `skills/`, `commands/`, `agents/`, `hooks/hooks.json`, `.mcp.json` and `mcp.json`: adding a skill folder or editing a hook file in a folder installed in place is read again on the next use. A file outside those locations that a Claude Code manifest names is not stamped; command bodies and agent prompts are read from their files when used, so their text is always current. Binding — the place with the project root, option values and secret values — is redone per use and cheap; `PluginLoaded.revision` hashes the stamp and the place, so a consumer that caches its own derivation keys on it.