---
id: 01a123ad-a26a-771a-b839-5773f1844d71
title: A plugin secret lives in a file and in the process env, and the declaration is learned at startup
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/secrets/keeper.ts
  - kind: file
    ref: apps/tagma/server/src/secrets/store.ts
---
A plugin's secret value lives only in the `plugin-secrets.json` file of the data directory (0600, through `CredentialFile`) and in the plugin process's env. It never enters settings, the graph, feeds, or operation answers: reading answers `{name, description, set}`, writing answers with no value string, and store refusals do not repeat the file error text, because parsing the document quotes what lies in it. So a secret cannot be a setting: settings are read through `read_settings` and the live channel.

Which secrets are declared is learned by the module at startup, not when contributions publish: the environment provider receives the checked manifest before the process starts and remembers the declaration right away. Otherwise a plugin that crashes without the secret would never show the field it is entered in. For the same reason the `register` point is empty: the schema checks the declaration in the manifest, and the startup gives it meaning. The declaration appears after the first read of an enabled plugin's manifest; a disabled plugin shows no fields.

The value enters the redactor in two forms — as is and as inside a JSON string — because a tool often answers JSON text. A short value masks every occurrence of itself in any answer, and that is the operator's decision.

Changing or removing a value triggers `PluginLaunches.changed`: the env fingerprint changes, the process restarts once. Repeating the same value changes no fingerprint and touches no process. A removed plugin's values stay in the file, as does its data; `remove_plugin_secret` removes them.
