---
id: 01a14c05-9e8f-7c75-a633-b2a10e594302
title: Settings resolve over user and project layers, keep the author and check against the key declaration
ord: 1
tags: ["feature"]
fields:
  {
    "state": "partial"
  }
edges:
  - kind: relates
    to: 01a136c1-4ec1-7395-bc66-acdb0a20e25b
  - kind: relates
    to: 01a14bae-6720-7d62-897a-927fda029bcc
sources:
  - kind: file
    ref: apps/tagma/server/src/settings/contract/wire/catalog.ts
  - kind: file
    ref: apps/tagma/server/src/settings/operations.ts
  - kind: file
    ref: apps/tagma/server/src/settings/resolution.ts
  - kind: file
    ref: apps/tagma/server/src/settings/writes.ts
  - kind: symbol
    ref: apps/tagma/server/src/settings/voice.ts
    symbol: settingsEntryLine
---
**Value.** The operator sets machine-wide behaviour and project exceptions, and the agent reads the effective value with its provenance, without parsing config files.

**How.** `read_settings`, `write_setting` and `write_setting_layer`; the Settings screen writes the explicit layer.

**Behaviour.** A key declares admissible layers, value shape and merge mode. The project overrides the user layer; lists may append or merge, and opting out of a lower-priority layer leaves only the current layer's values. Clearing removes the override. The `write_setting` answer names the project, key, effective value and its source; `write_setting_layer` returns the updated catalog for the Settings screen. The catalog names the author, layers and unreadable values; invalid elements of declared lists do not hide readable ones. Keys with their own managing act change at it. A choice marked as operator-owned requires agreement by call mode.

**Limits.** The promise of `read_settings` to show agent writability is partly fulfilled: the native-answer text does not print the operator-only mark, and the answer row's wire schema does not declare it at the top level. The write guard acts regardless of this gap. The promised channel-defaults layer is not yet in resolution: the code starts from the key's single default.
