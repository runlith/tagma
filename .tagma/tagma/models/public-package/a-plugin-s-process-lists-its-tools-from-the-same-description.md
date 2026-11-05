---
id: 01a1ae0e-8cd1-7806-8dbc-86e905f8b9ec
title: A plugin's process lists its tools from the same description of its definition that the build wrote into the manifest
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/tagma/src/plugin/describe.ts
---
The build imports `plugin.ts` without running a handler, and `describePlugin` turns the definition into the manifest's tools and contributions. The bundled runtime reruns the same function over the same definition to answer `tools/list`. It reads no `tagma-plugin.json`, so `/testing` serves a definition the way the process does, with no folder. The host refuses a generation whose listing differs from the manifest, so the description must be a pure function of the source. A definition that computes a description, an input schema or a name from the environment or the clock builds one listing and serves another, and its process never opens. A tool input's JSON Schema is the validator's own Standard JSON Schema output for draft 2020-12, without `$schema`. A tool without an input lists an empty closed object.