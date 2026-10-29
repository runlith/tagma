---
id: 01a146c4-cec5-776f-bf72-4a142eb96af9
title: "A setting's section is the first segment of its id: declaring the key does not write the section"
ord: 1
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a146b3-b002-7843-b99c-f05ff5cefe48
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/contract/wire/setting.ts
  - kind: file
    ref: apps/tagma/server/src/settings/layer.ts
---
`settingKey` and `settingListKey` derive `section` from the key id, and declaring it does not write: one notion — one spelling. An agent finds the section by the key it already knows: `agent` for `agent.offered`; a separately written section diverged from the id, and `read_settings` refused on the section named by the key.

A key with no dot does not assemble: the id type is `<section>.<name>`. The section is declared by the owner module in its manifest; a key whose section nobody declared does not let the settings layer assemble — the server does not start instead of hiding the key from `read_settings {section}`.
